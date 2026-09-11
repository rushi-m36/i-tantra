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

    const startDiscoveryFlow = async () => {
      const discovery = await getDeviceDiscovery();
      if (!active || callState !== "idle") return;

      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      nsdSubscription?.remove();
      nsdSubscription = null;
      NativeModules.NsdDiscovery?.stop?.();
      discovery.stopDiscovery();

      let nsdFoundDevice = false;
      const ownServiceName = `iTantra-${discovery.getDeviceId().slice(-8)}`;

      discovery.setDiscoveryPhase("nsd");

      try {
        NativeModules.NsdDiscovery?.start?.(
          discovery.getDeviceId(),
          discovery.getDeviceName(),
          TCP_PORT,
        );
      } catch {}

      nsdSubscription = DeviceEventEmitter.addListener(
        "itantraNsdDeviceFound",
        (device: NsdDevice) => {
          if (!active || nsdFoundDevice || !device?.host || device.serviceName === ownServiceName) return;

          nsdFoundDevice = true;
          discovery.addDevice({
            id: device.serviceName,
            name: device.serviceName,
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
        },
      );

      fallbackTimer = setTimeout(() => {
        if (!active || nsdFoundDevice) return;
        discovery.setDiscoveryPhase("tcp");
        discovery.startDiscovery();
      }, NSD_FALLBACK_DELAY);
    };

    const refreshSubscription = DeviceEventEmitter.addListener(
      "itantraRefreshDiscovery",
      () => {
        if (!active || callState !== "idle") return;
        void startDiscoveryFlow();
      },
    );

    if (callState === "idle") {
      void startDiscoveryFlow();
    } else {
      void getDeviceDiscovery().then((discovery) => {
        discovery.stopDiscovery();
        NativeModules.NsdDiscovery?.stop?.();
      });
    }

    return () => {
      active = false;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      nsdSubscription?.remove();
      refreshSubscription.remove();
      void getDeviceDiscovery().then((discovery) => discovery.stopDiscovery()).catch(() => {});
      NativeModules.NsdDiscovery?.stop?.();
    };
  }, [callState]);

  return null;
}
