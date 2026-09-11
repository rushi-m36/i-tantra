import NetInfo from "@react-native-community/netinfo";
import { getDeviceName, getUniqueId, getIpAddress } from "react-native-device-info";
import TcpSocket from "react-native-tcp-socket";
import { Device } from "../../types/communication";

const DISCOVERY_PORT = 5556;
const TCP_PORT = 5555;
const SCAN_INTERVAL = 5000;
const DEVICE_TIMEOUT = 12000;
const CONNECT_TIMEOUT = 700;
const MAX_CONCURRENT_SCANS = 20;
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

  async getNetworkInfo(): Promise<{ ip: string; subnet: string; isWifi: boolean } | null> {
    try {
      const state = await NetInfo.fetch();
      const details = state.details as any;
      let ip = typeof details?.ipAddress === "string" ? details.ipAddress : null;

      if (!ip) {
        try {
          const deviceInfoIp = await getIpAddress();
          if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(deviceInfoIp)) ip = deviceInfoIp;
        } catch {}
      }

      // Android hotspot/tethering can report an incomplete NetInfo object.
      // Keep discovery alive by using the standard /24 tethering ranges when
      // Android does not expose the interface address to React Native.
      if (!ip || ip === "0.0.0.0") {
        const fallbackIp = await this.findLikelyLocalIpv4();
        if (fallbackIp) ip = fallbackIp;
      }

      if (!ip || ip === "0.0.0.0") {
        console.log("Device discovery skipped: no local IPv4 address");
        return null;
      }

      const subnet = typeof details?.subnet === "string" && details.subnet.length > 0
        ? details.subnet
        : "255.255.255.0";
      const isWifi = state.type === "wifi" || this.isPrivateIpv4(ip);
      console.log(`Network available: ${state.type}, IP ${ip}, subnet ${subnet}`);
      return { ip, subnet, isWifi };
    } catch (e) {
      console.error("Failed to get network info:", e);
      return null;
    }
  }

  private async findLikelyLocalIpv4(): Promise<string | null> {
    try {
      const ip = await getIpAddress();
      if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip) && ip !== "0.0.0.0") return ip;
    } catch {}
    return null;
  }

  private isPrivateIpv4(ip: string): boolean {
    const parts = ip.split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    return parts[0] === 10 || parts[0] === 192 && parts[1] === 168 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
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
      console.error("Failed to start device discovery server:", error);
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
      const addresses = this.getSubnetAddresses(network.ip, network.subnet);
      this.scanStatus = { scanning: true, currentIp: null, scanned: 0, total: addresses.length, found: this.discoveredDevices.size };
      this.notifyScanStatus();
      console.log(`Scanning ${addresses.length} local addresses for iTantra devices...`);
      for (let index = 0; index < addresses.length; index += MAX_CONCURRENT_SCANS) {
        const batch = addresses.slice(index, index + MAX_CONCURRENT_SCANS);
        this.scanStatus = { ...this.scanStatus, currentIp: batch[0] || null };
        this.notifyScanStatus();
        await Promise.all(batch.map((ip) => this.probeDevice(ip)));
        this.scanStatus = { ...this.scanStatus, scanned: Math.min(index + batch.length, addresses.length), currentIp: addresses[Math.min(index + batch.length, addresses.length) - 1] || null, found: this.discoveredDevices.size };
        this.notifyScanStatus();
      }
    } catch (error) {
      console.error("Local network scan failed:", error);
    } finally {
      this.scanInProgress = false;
      this.scanStatus = { ...this.scanStatus, scanning: false, currentIp: null, found: this.discoveredDevices.size };
      this.notifyScanStatus();
    }
  }

  private getSubnetAddresses(ip: string, subnet: string): string[] {
    const ipParts = ip.split(".").map(Number);
    const maskParts = subnet.split(".").map(Number);
    const validIp = ipParts.length === 4 && ipParts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255);
    const validMask = maskParts.length === 4 && maskParts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255);

    // Some Android hotspot implementations expose the IP but return an
    // unusable/zero subnet. In that case, scan the normal tethering /24.
    if (!validIp) return this.getCommonHotspotAddresses();
    if (!validMask || subnet === "0.0.0.0") subnet = "255.255.255.0";

    const mask = subnet.split(".").map(Number);
    const ipNumber = ((ipParts[0] << 24) >>> 0) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3];
    const maskNumber = ((mask[0] << 24) >>> 0) | (mask[1] << 16) | (mask[2] << 8) | mask[3];
    const networkNumber = (ipNumber & maskNumber) >>> 0;
    const broadcastNumber = (networkNumber | (~maskNumber >>> 0)) >>> 0;
    const addresses: string[] = [];
    const start = networkNumber + 1;
    const end = broadcastNumber - 1;

    if (end - start > 1022) {
      const prefix = ipParts.slice(0, 3).join(".");
      for (let host = 1; host <= 254; host++) { const candidate = `${prefix}.${host}`; if (candidate !== ip) addresses.push(candidate); }
      return addresses;
    }
    for (let value = start; value <= end; value++) {
      const candidate = [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join(".");
      if (candidate !== ip) addresses.push(candidate);
    }
    return addresses;
  }

  private getCommonHotspotAddresses(): string[] {
    // Common Android/Windows tethering networks. This is only a fallback when
    // the platform does not expose a usable local IPv4 address/subnet.
    const prefixes = ["192.168.43", "192.168.137", "192.168.42"];
    const addresses: string[] = [];
    for (const prefix of prefixes) {
      for (let host = 1; host <= 254; host++) addresses.push(`${prefix}.${host}`);
    }
    return addresses;
  }

  private probeDevice(ip: string): Promise<void> {
    return this.probePort(ip, DISCOVERY_PORT, true).then((found) => {
      if (!found) return this.probePort(ip, TCP_PORT, false).then((fallbackFound) => { if (fallbackFound) return; });
    });
  }

  private probePort(ip: string, port: number, discoveryPort: boolean): Promise<boolean> {
    return new Promise((resolve) => {
      let socket: any = null;
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let responseBuffer = "";
      const finish = (found = false) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (socket && !socket.destroyed) socket.destroy();
        resolve(found);
      };
      try {
        socket = TcpSocket.createConnection({ host: ip, port, reuseAddress: true, connectTimeout: CONNECT_TIMEOUT }, () => {
          socket.write(`${discoveryPort ? DISCOVERY_REQUEST : TCP_PROBE}\n`);
        });
        timer = setTimeout(() => finish(false), CONNECT_TIMEOUT + 300);
        socket.on("data", (data: any) => {
          try {
            responseBuffer += typeof data === "string" ? data : data.toString("utf8");
            const line = responseBuffer.split("\n")[0].trim();
            const response = JSON.parse(line) as DiscoveryResponse;
            const expectedMagic = discoveryPort ? DISCOVERY_REQUEST : TCP_PROBE;
            if (response.magic === expectedMagic && response.id && response.id !== this.deviceId && response.name) {
              this.addDevice({ id: response.id, name: response.name, ip, port: response.port || TCP_PORT, status: "available", lastSeen: Date.now() });
              finish(true);
              return;
            }
          } catch {}
          if (discoveryPort) finish(false);
        });
        socket.on("error", () => finish(false));
        socket.on("close", () => finish(false));
      } catch { finish(false); }
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
