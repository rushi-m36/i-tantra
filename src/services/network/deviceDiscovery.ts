import NetInfo from "@react-native-community/netinfo";
import { getDeviceName, getUniqueId, getIpAddress } from "react-native-device-info";
import { NativeModules } from "react-native";
import TcpSocket from "react-native-tcp-socket";
import { Device } from "../../types/communication";

const DISCOVERY_PORT = 5556;
const TCP_PORT = 5555;
const SCAN_INTERVAL = 5000;
const DEVICE_TIMEOUT = 12000;
const CONNECT_TIMEOUT = 3500;
// Temporary diagnostic settings: scan only .100-.130 and keep concurrency low.
// Restore the full-subnet scan and higher concurrency after hotspot discovery works.
const MAX_CONCURRENT_SCANS = 4;
const DIAGNOSTIC_SCAN_START = 100;
const DIAGNOSTIC_SCAN_END = 130;
const DISCOVERY_REQUEST = "ITANTRA_DISCOVER_V1";
const TCP_PROBE = "ITANTRA_PROBE_V1";

const generateUUID = (): string =>
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });

interface DiscoveryResponse { magic: string; id: string; name: string; port: number; }

export interface ScanStatus {
  scanning: boolean;
  currentIp: string | null;
  scanned: number;
  total: number;
  found: number;
}

const LocalNetwork = NativeModules.LocalNetwork as {
  getLocalIPv4Addresses?: () => Promise<string[]>;
} | undefined;

export class DeviceDiscovery {
  private deviceId: string;
  private deviceName = "";
  private discoveredDevices: Map<string, Device> = new Map();
  private discoveryCallbacks: Array<(devices: Device[]) => void> = [];
  private scanCallbacks: Array<(status: ScanStatus) => void> = [];
  private broadcastInterval: ReturnType<typeof setInterval> | null = null;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private discoveryServer: any = null;
  private scanInProgress = false;
  private scanStatus: ScanStatus = { scanning: false, currentIp: null, scanned: 0, total: 0, found: 0 };

  constructor() { this.deviceId = generateUUID(); }

  async initialize(): Promise<void> {
    try {
      const [deviceName, uniqueId] = await Promise.all([getDeviceName(), getUniqueId()]);
      this.deviceName = deviceName || `Device-${this.deviceId.substring(0, 8)}`;
      if (uniqueId) this.deviceId = uniqueId;
    } catch { this.deviceName = `Device-${this.deviceId.substring(0, 8)}`; }
  }

  async getNetworkInfo(): Promise<{ ip: string; subnet: string; isWifi: boolean; fallback: boolean } | null> {
    try {
      const state = await NetInfo.fetch();
      const details = state.details as any;
      let nativeIps: string[] = [];

      try {
        if (LocalNetwork?.getLocalIPv4Addresses) {
          nativeIps = (await LocalNetwork.getLocalIPv4Addresses()).filter((value) => this.isValidIpv4(value));
        }
      } catch (error) {
        console.log("Native local IPv4 lookup failed:", error);
      }

      let deviceInfoIp: string | null = null;
      try {
        const value = await getIpAddress();
        if (this.isValidIpv4(value)) deviceInfoIp = value;
      } catch {}

      const netInfoIp = typeof details?.ipAddress === "string" && this.isValidIpv4(details.ipAddress)
        ? details.ipAddress
        : null;

      const privateIps = [...nativeIps, deviceInfoIp, netInfoIp]
        .filter((value): value is string => !!value)
        .filter((value, index, values) => values.indexOf(value) === index)
        .filter((value) => this.isPrivateIpv4(value));

      if (privateIps.length === 0) {
        console.log("No private local IPv4 reported; starting common hotspot fallback scan");
        return { ip: "192.168.43.1", subnet: "255.255.255.0", isWifi: true, fallback: true };
      }

      const ip = privateIps[0];
      let subnet = typeof details?.subnet === "string" ? details.subnet : "";
      if (!this.isUsableSubnet(subnet)) subnet = "255.255.255.0";

      console.log(`Network available: ${state.type}, IP ${ip}, subnet ${subnet}`);
      console.log(`[DISCOVERY NETWORK] Android IPv4 interfaces: ${privateIps.join(", ")}`);
      return { ip, subnet, isWifi: state.type === "wifi" || this.isPrivateIpv4(ip), fallback: false };
    } catch (e) {
      console.error("Failed to get network info:", e);
      console.log("Starting common hotspot fallback scan");
      return { ip: "192.168.43.1", subnet: "255.255.255.0", isWifi: true, fallback: true };
    }
  }

  private isValidIpv4(ip: string | null | undefined): ip is string {
    if (!ip || !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip) || ip === "0.0.0.0") return false;
    return ip.split(".").every((part) => {
      const value = Number(part);
      return Number.isInteger(value) && value >= 0 && value <= 255;
    });
  }

  private isUsableSubnet(subnet: string): boolean {
    const parts = subnet.split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    const value = parts.reduce((acc, part) => (acc * 256) + part, 0);
    if (value === 0 || value === 0xffffffff) return false;
    const inverted = (~value) >>> 0;
    return (inverted & (inverted + 1)) === 0;
  }

  private isPrivateIpv4(ip: string): boolean {
    const parts = ip.split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    return parts[0] === 10 || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
  }

  addDevice(device: Device): void {
    if (device.id === this.deviceId) return;
    device.lastSeen = Date.now();
    this.discoveredDevices.set(device.id, device);
    this.scanStatus = { ...this.scanStatus, found: this.discoveredDevices.size };
    this.notifyDevicesChanged();
    this.notifyScanStatus();
  }

  getDeviceId(): string { return this.deviceId; }
  getDeviceName(): string { return this.deviceName; }
  getDiscoveredDevices(): Device[] { return Array.from(this.discoveredDevices.values()).filter((d) => d.id !== this.deviceId); }
  onDevicesChanged(callback: (devices: Device[]) => void): void { this.discoveryCallbacks.push(callback); }
  onScanStatusChanged(callback: (status: ScanStatus) => void): void { this.scanCallbacks.push(callback); callback(this.scanStatus); }
  getScanStatus(): ScanStatus { return this.scanStatus; }

  startDiscovery(): void {
    if (this.discoveryServer || this.broadcastInterval) return;
    this.startDiscoveryServer();
    void this.scanLocalNetwork();
    this.broadcastInterval = setInterval(() => { void this.scanLocalNetwork(); }, SCAN_INTERVAL);
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      let changed = false;
      this.discoveredDevices.forEach((device, id) => {
        if (now - device.lastSeen > DEVICE_TIMEOUT) { this.discoveredDevices.delete(id); changed = true; }
      });
      if (changed) this.notifyDevicesChanged();
    }, 5000);
  }

  private startDiscoveryServer(): void {
    try {
      this.discoveryServer = TcpSocket.createServer((socket: any) => {
        let buffer = "";
        socket.on("data", (data: any) => {
          try {
            buffer += typeof data === "string" ? data : data.toString("utf8");
            if (!buffer.includes("\n")) return;
            const request = buffer.split("\n")[0].trim();
            if (request !== DISCOVERY_REQUEST) { socket.destroy(); return; }
            const response: DiscoveryResponse = { magic: DISCOVERY_REQUEST, id: this.deviceId, name: this.deviceName, port: TCP_PORT };
            socket.write(JSON.stringify(response) + "\n", "utf-8", () => socket.destroy());
          } catch { socket.destroy(); }
        });
        socket.on("error", () => socket.destroy());
      });
      this.discoveryServer.on("error", (error: any) => {
        console.error("Device discovery server error:", error);
        this.discoveryServer = null;
      });
      this.discoveryServer.listen({ port: DISCOVERY_PORT, host: "0.0.0.0", reuseAddress: true }, () => console.log("Device discovery listening on port", DISCOVERY_PORT));
    } catch (error) {
      console.error("Failed to start device discovery:", error);
      this.discoveryServer = null;
    }
  }

  private async scanLocalNetwork(): Promise<void> {
    if (this.scanInProgress) return;
    this.scanInProgress = true;
    try {
      const network = await this.getNetworkInfo();
      if (!network) {
        this.scanStatus = { scanning: false, currentIp: null, scanned: 0, total: 0, found: this.discoveredDevices.size };
        this.notifyScanStatus();
        return;
      }

      const addresses = network.fallback
        ? this.getCommonHotspotAddresses()
        : this.getSubnetAddresses(network.ip, network.subnet);

      this.scanStatus = { scanning: true, currentIp: null, scanned: 0, total: addresses.length, found: this.discoveredDevices.size };
      this.notifyScanStatus();
      console.log(`[DISCOVERY SCAN] Diagnostic range: .${DIAGNOSTIC_SCAN_START}-.${DIAGNOSTIC_SCAN_END}`);
      console.log(`[DISCOVERY SCAN] Scanning ${addresses.length} addresses on port ${TCP_PORT} first, then ${DISCOVERY_PORT}${network.fallback ? " (hotspot fallback)" : ""}`);

      for (let index = 0; index < addresses.length; index += MAX_CONCURRENT_SCANS) {
        const batch = addresses.slice(index, index + MAX_CONCURRENT_SCANS);
        this.scanStatus = { ...this.scanStatus, currentIp: batch[0] || null };
        this.notifyScanStatus();
        await Promise.all(batch.map((ip) => this.probeDevice(ip)));
        this.scanStatus = {
          ...this.scanStatus,
          scanned: Math.min(index + batch.length, addresses.length),
          currentIp: addresses[Math.min(index + batch.length, addresses.length) - 1] || null,
          found: this.discoveredDevices.size,
        };
        this.notifyScanStatus();
        console.log(`[DISCOVERY SCAN] Progress: ${Math.min(index + batch.length, addresses.length)}/${addresses.length}, found ${this.discoveredDevices.size}`);
      }
    } catch (error) {
      console.error("Local network scan failed:", error);
    } finally {
      this.scanInProgress = false;
      this.scanStatus = { ...this.scanStatus, scanning: false, currentIp: null, found: this.discoveredDevices.size };
      this.notifyScanStatus();
    }
  }

  private getCommonHotspotAddresses(): string[] {
    const prefixes = ["192.168.43", "192.168.137", "192.168.42"];
    const addresses: string[] = [];
    for (const prefix of prefixes) {
      for (let host = 1; host <= 254; host++) addresses.push(`${prefix}.${host}`);
    }
    return addresses;
  }

  private getSubnetAddresses(ip: string, subnet: string): string[] {
    const ipParts = ip.split(".").map(Number);
    const validIp = ipParts.length === 4 && ipParts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255);
    const validMask = this.isUsableSubnet(subnet);
    if (!validIp) return this.getCommonHotspotAddresses();
    if (!validMask) subnet = "255.255.255.0";

    const mask = subnet.split(".").map(Number);
    const ipNumber = ((ipParts[0] << 24) >>> 0) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3];
    const maskNumber = ((mask[0] << 24) >>> 0) | (mask[1] << 16) | (mask[2] << 8) | mask[3];
    const networkNumber = (ipNumber & maskNumber) >>> 0;
    const broadcastNumber = (networkNumber | (~maskNumber >>> 0)) >>> 0;
    const addresses: string[] = [];
    const start = networkNumber + 1;
    const end = broadcastNumber - 1;

    // Temporary diagnostic scan: only test .100 through .130 on the same /24.
    // This deliberately includes the laptop at 10.190.147.112.
    const prefix = ipParts.slice(0, 3).join(".");
    const diagnosticStart = Math.max(DIAGNOSTIC_SCAN_START, (start >>> 0) & 255);
    const diagnosticEnd = Math.min(DIAGNOSTIC_SCAN_END, (end >>> 0) & 255);
    if (prefix === "10.190.147" && diagnosticStart <= diagnosticEnd) {
      for (let host = diagnosticStart; host <= diagnosticEnd; host++) {
        const candidate = `${prefix}.${host}`;
        if (candidate !== ip) addresses.push(candidate);
      }
      return addresses;
    }

    if (end - start > 1022) {
      for (let host = 1; host <= 254; host++) { const candidate = `${prefix}.${host}`; if (candidate !== ip) addresses.push(candidate); }
      return addresses;
    }
    for (let value = start; value <= end; value++) {
      const candidate = [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join(".");
      if (candidate !== ip) addresses.push(candidate);
    }
    return addresses;
  }

  private probeDevice(ip: string): Promise<void> {
    return this.probePort(ip, TCP_PORT, false).then((found) => {
      if (!found) return this.probePort(ip, DISCOVERY_PORT, true).then(() => undefined);
    });
  }

  private probePort(ip: string, port: number, discoveryPort: boolean): Promise<boolean> {
    const diagnosticTarget = ip === "10.190.147.112";
    if (diagnosticTarget) console.log(`[DISCOVERY PROBE] Trying ${ip}:${port}`);

    return new Promise((resolve) => {
      let socket: any = null;
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let responseBuffer = "";
      const finish = (found = false, reason = "unknown") => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (socket && !socket.destroyed) socket.destroy();
        if (diagnosticTarget) console.log(`[DISCOVERY PROBE] ${ip}:${port} -> ${reason}`);
        resolve(found);
      };
      try {
        socket = TcpSocket.createConnection({ host: ip, port, reuseAddress: true, connectTimeout: CONNECT_TIMEOUT }, () => {
          if (diagnosticTarget) console.log(`[DISCOVERY PROBE] Connected to ${ip}:${port}`);
          socket.write(`${discoveryPort ? DISCOVERY_REQUEST : TCP_PROBE}\n`);
        });
        timer = setTimeout(() => finish(false, "timeout"), CONNECT_TIMEOUT + 500);
        socket.on("data", (data: any) => {
          try {
            responseBuffer += typeof data === "string" ? data : data.toString("utf8");
            const line = responseBuffer.split("\n")[0].trim();
            const response = JSON.parse(line) as DiscoveryResponse;
            const expectedMagic = discoveryPort ? DISCOVERY_REQUEST : TCP_PROBE;
            if (response.magic === expectedMagic && response.id && response.id !== this.deviceId && response.name) {
              if (diagnosticTarget) console.log(`[DISCOVERY PROBE] Valid response from ${ip}:${port}`);
              this.addDevice({ id: response.id, name: response.name, ip, port: response.port || TCP_PORT, status: "available", lastSeen: Date.now() });
              finish(true, "FOUND");
              return;
            }
          } catch {}
          if (discoveryPort) finish(false, "invalid response");
        });
        socket.on("error", (error: any) => finish(false, `error ${error?.code || error?.message || "unknown"}`));
        socket.on("close", () => finish(false, "closed"));
      } catch (error: any) { finish(false, `exception ${error?.message || "unknown"}`); }
    });
  }

  stopDiscovery(): void {
    if (this.cleanupInterval) { clearInterval(this.cleanupInterval); this.cleanupInterval = null; }
    if (this.broadcastInterval) { clearInterval(this.broadcastInterval); this.broadcastInterval = null; }
    if (this.discoveryServer) { try { this.discoveryServer.close(); } catch {} this.discoveryServer = null; }
    this.scanStatus = { ...this.scanStatus, scanning: false, currentIp: null };
    this.notifyScanStatus();
  }

  private notifyDevicesChanged(): void { this.discoveryCallbacks.forEach((cb) => cb(this.getDiscoveredDevices())); }
  private notifyScanStatus(): void { this.scanCallbacks.forEach((cb) => cb(this.scanStatus)); }

  cleanup(): void {
    this.stopDiscovery();
    this.discoveredDevices.clear();
    this.discoveryCallbacks = [];
    this.scanCallbacks = [];
  }
}

let discoveryInstance: DeviceDiscovery | null = null;
export async function getDeviceDiscovery(): Promise<DeviceDiscovery> {
  if (!discoveryInstance) { discoveryInstance = new DeviceDiscovery(); await discoveryInstance.initialize(); }
  return discoveryInstance;
}