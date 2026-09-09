import NetInfo from "@react-native-community/netinfo";
import { getDeviceName } from "react-native-device-info";
import { Device } from "../../types/communication";

const generateUUID = (): string => {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

const BROADCAST_INTERVAL = 3000;
const DEVICE_TIMEOUT = 10000;

export class DeviceDiscovery {
  private deviceId: string;
  private deviceName: string = "";
  private discoveredDevices: Map<string, Device> = new Map();
  private discoveryCallbacks: Array<(devices: Device[]) => void> = [];
  private broadcastInterval: ReturnType<typeof setInterval> | null = null;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.deviceId = generateUUID();
  }

  async initialize(): Promise<void> {
    try {
      const deviceName = await getDeviceName();
      this.deviceName = deviceName || `Device-${this.deviceId.substring(0, 8)}`;
    } catch (e) {
      this.deviceName = `Device-${this.deviceId.substring(0, 8)}`;
    }
  }

  /**
   * Get local network info
   */
  async getNetworkInfo(): Promise<{ ip: string; isWifi: boolean } | null> {
    try {
      const state = await NetInfo.fetch();

      if (state.type === "wifi" && state.details?.ipAddress) {
        return { ip: state.details.ipAddress, isWifi: true };
      }

      return null;
    } catch (e) {
      console.error("Failed to get network info:", e);
      return null;
    }
  }

  /**
   * Add discovered device
   */
  addDevice(device: Device): void {
    device.lastSeen = Date.now();
    this.discoveredDevices.set(device.id, device);
    this.notifyDevicesChanged();
  }

  /**
   * Get current device ID
   */
  getDeviceId(): string {
    return this.deviceId;
  }

  /**
   * Get current device name
   */
  getDeviceName(): string {
    return this.deviceName;
  }

  /**
   * Get all discovered devices (excluding self)
   */
  getDiscoveredDevices(): Device[] {
    return Array.from(this.discoveredDevices.values()).filter(
      (d) => d.id !== this.deviceId,
    );
  }

  /**
   * Register callback for device list changes
   */
  onDevicesChanged(callback: (devices: Device[]) => void): void {
    this.discoveryCallbacks.push(callback);
  }

  /**
   * Start discovery (cleanup stale devices)
   */
  startDiscovery(): void {
    // Cleanup stale devices every 5 seconds
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      let changed = false;

      this.discoveredDevices.forEach((device, id) => {
        if (now - device.lastSeen > DEVICE_TIMEOUT) {
          this.discoveredDevices.delete(id);
          changed = true;
        }
      });

      if (changed) {
        this.notifyDevicesChanged();
      }
    }, 5000);
  }

  /**
   * Stop discovery
   */
  stopDiscovery(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
      this.broadcastInterval = null;
    }
  }

  /**
   * Notify listeners of device changes
   */
  private notifyDevicesChanged(): void {
    const devices = this.getDiscoveredDevices();
    this.discoveryCallbacks.forEach((cb) => cb(devices));
  }

  /**
   * Cleanup
   */
  cleanup(): void {
    this.stopDiscovery();
    this.discoveredDevices.clear();
    this.discoveryCallbacks = [];
  }
}

// Singleton instance
let discoveryInstance: DeviceDiscovery | null = null;

export async function getDeviceDiscovery(): Promise<DeviceDiscovery> {
  if (!discoveryInstance) {
    discoveryInstance = new DeviceDiscovery();
    await discoveryInstance.initialize();
  }
  return discoveryInstance;
}
