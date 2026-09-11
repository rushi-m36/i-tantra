import { useEffect } from "react";
import { DeviceEventEmitter, NativeModules } from "react-native";
import { getDeviceDiscovery } from "../services/network/deviceDiscovery";
import { useCommunication } from "../context/CommunicationContext";

const NSD_FALLBACK_DELAY = 2000;
const TCP_PORT = 5555;

interface NsdDevice {
  serviceName: string;
  host: string;
  port: number;
}

export function DiscoveryLifecycle() {
  const { callState, discoveryRefreshKey } = useCommunication();

  useEffect(() => {
    let active = true;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let nsdSubscription: { remove: () => void } | null = null;

    void getDeviceDiscovery().then((discovery) => {
      if (!active) return;

      const inCall = callState === "calling" || callState === "incoming" || callState === "connected";
      if (inCall) {
        discovery.stopDiscovery();
        NativeModules.NsdDiscovery?.stop?.();
        return;
      }
      if (callState !== "idle") return;

      let nsdFoundDevice = false;
      const ownServiceName = `iTantra-${discovery.getDeviceId().slice(-8)}`;

      discovery.stopDiscovery();
      discovery.setDiscoveryPhase("nsd");

      nsdSubscription = DeviceEventEmitter.addListener("itantraNsdDeviceFound", (device: NsdDevice) => {
        if (!active || nsdFoundDevice || !device?.host || device.serviceName === ownServiceName) return;

        nsdFoundDevice = true;
        discovery.addDevice({
          id: device.serviceName,
          name: device.serviceName.replace(/^iTantra-/, "iTantra-"),
          ip: device.host,
          port: device.port || TCP_PORT,
          status: "available",
          lastSeen: Date.now(),
        });

        if (fallbackTimer) {
          clearTimeout(fallbackTimer);
          fallbackTimer = null;
        }
        discovery.stopDiscovery();
        discovery.setDiscoveryPhase("nsd-found");
      });

      try {
        NativeModules.NsdDiscovery?.start?.(discovery.getDeviceId(), discovery.getDeviceName(), TCP_PORT);
      } catch {}

      fallbackTimer = setTimeout(() => {
        if (!active || nsdFoundDevice) return;
        discovery.setDiscoveryPhase("tcp");
        discovery.startDiscovery();
      }, NSD_FALLBACK_DELAY);
    });

    return () => {
      active = false;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      nsdSubscription?.remove();
      void getDeviceDiscovery().then((discovery) => discovery.stopDiscovery()).catch(() => {});
      NativeModules.NsdDiscovery?.stop?.();
    };
  }, [callState, discoveryRefreshKey]);

  return null;
}
