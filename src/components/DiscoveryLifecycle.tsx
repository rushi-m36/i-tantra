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
  const { callState } = useCommunication();

  useEffect(() => {
    let active = true;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let nsdSubscription: { remove: () => void } | null = null;

    void getDeviceDiscovery().then((discovery) => {
      if (!active) return;

      if (
        callState === "calling" ||
        callState === "incoming" ||
        callState === "connected"
      ) {
        discovery.stopDiscovery();
        NativeModules.NsdDiscovery?.stop?.();
        return;
      }

      if (callState !== "idle") return;

      const ownServiceName = `iTantra-${discovery.getDeviceId().slice(-8)}`;
      let nsdFoundDevice = false;

      nsdSubscription = DeviceEventEmitter.addListener(
        "itantraNsdDeviceFound",
        (device: NsdDevice) => {
          if (!active || nsdFoundDevice) return;
          if (!device?.host || device.serviceName === ownServiceName) return;

          nsdFoundDevice = true;
          discovery.addDevice({
            id: device.serviceName,
            name: device.serviceName.replace(/^iTantra-/, "iTantra"),
            ip: device.host,
            port: device.port || TCP_PORT,
            status: "available",
            lastSeen: Date.now(),
          });
        },
      );

      try {
        NativeModules.NsdDiscovery?.start?.(
          discovery.getDeviceId(),
          discovery.getDeviceName(),
          TCP_PORT,
        );
      } catch {}

      // NSD is the primary discovery path. Only start the low-rate TCP scan
      // if NSD has not found a peer shortly after discovery starts.
      fallbackTimer = setTimeout(() => {
        if (active && !nsdFoundDevice) discovery.startDiscovery();
      }, NSD_FALLBACK_DELAY);
    });

    return () => {
      active = false;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      nsdSubscription?.remove();
      NativeModules.NsdDiscovery?.stop?.();
    };
  }, [callState]);

  return null;
}
