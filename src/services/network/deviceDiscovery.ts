import { getDeviceName, getUniqueId } from "react-native-device-info";
import { Device } from "../../types/communication";

export type DiscoveryPhase = "idle" | "nsd" | "nsd-found";

export interface ScanStatus {
  scanning: boolean;
  currentIp: string | null;
  scanned: number;
  total: number;
  found: number;
  phase: DiscoveryPhase;
}

const generateUUID = (): string => "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; const v = c === "x" ? r : (r & 0x3) | 0x8; return v.toString(16); });

export class DeviceDiscovery {
  private deviceId: string;
  private deviceName = "";
  private discoveredDevices: Map<string, Device> = new Map();
  private discoveryCallbacks: Array<(devices: Device[]) => void> = [];
  private scanCallbacks: Array<(status: ScanStatus) => void> = [];
  private scanStatus: ScanStatus = { scanning: false, currentIp: null, scanned: 0, total: 0, found: 0, phase: "idle" };

  constructor() { this.deviceId = generateUUID(); }

  async initialize(): Promise<void> {
    try {
      const [deviceName, uniqueId] = await Promise.all([getDeviceName(), getUniqueId()]);
      this.deviceName = deviceName || `Device-${this.deviceId.substring(0, 8)}`;
      if (uniqueId) this.deviceId = uniqueId;
    } catch {
      this.deviceName = `Device-${this.deviceId.substring(0, 8)}`;
    }
  }

  addDevice(device: Device): void {
    if (device.id === this.deviceId) return;
    device.lastSeen = Date.now();
    this.discoveredDevices.set(device.id, device);
    this.scanStatus = { ...this.scanStatus, found: this.discoveredDevices.size };
    this.notifyDevicesChanged();
    this.notifyScanStatus();
  }

  setDiscoveryPhase(phase: DiscoveryPhase): void {
    this.scanStatus = {
      ...this.scanStatus,
      phase,
      scanning: phase === "nsd",
      currentIp: null,
      total: 0,
      scanned: 0,
    };
    this.notifyScanStatus();
  }

  getDeviceId(): string { return this.deviceId; }
  getDeviceName(): string { return this.deviceName; }
  getDiscoveredDevices(): Device[] { return Array.from(this.discoveredDevices.values()).filter((d) => d.id !== this.deviceId); }
  onDevicesChanged(callback: (devices: Device[]) => void): void { this.discoveryCallbacks.push(callback); }
  onScanStatusChanged(callback: (status: ScanStatus) => void): void { this.scanCallbacks.push(callback); callback(this.scanStatus); }
  getScanStatus(): ScanStatus { return this.scanStatus; }

  stopDiscovery(): void {
    this.scanStatus = { ...this.scanStatus, scanning: false, currentIp: null, phase: "idle", total: 0, scanned: 0 };
    this.notifyScanStatus();
  }

  private notifyDevicesChanged(): void { this.discoveryCallbacks.forEach((cb) => cb(this.getDiscoveredDevices())); }
  private notifyScanStatus(): void { this.scanCallbacks.forEach((cb) => cb(this.scanStatus)); }
  cleanup(): void { this.stopDiscovery(); this.discoveredDevices.clear(); this.discoveryCallbacks = []; this.scanCallbacks = []; }
}

let discoveryInstance: DeviceDiscovery | null = null;
export async function getDeviceDiscovery(): Promise<DeviceDiscovery> { if (!discoveryInstance) { discoveryInstance = new DeviceDiscovery(); await discoveryInstance.initialize(); } return discoveryInstance; }
