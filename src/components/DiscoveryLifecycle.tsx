import { useEffect } from "react";
import { DeviceEventEmitter, NativeModules } from "react-native";
import { getDeviceDiscovery } from "../services/network/deviceDiscovery";
import { useCommunication } from "../context/CommunicationContext";

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
    let nsdSubscription: { remove: () => void } | null = null;

    const stopDiscovery = async () => {
      const discovery = await getDeviceDiscovery();
      discovery.stopDiscovery();
      NativeModules.NsdDiscovery?.stop?.();
    };

    const startNsdDiscovery = async () => {
      const discovery = await getDeviceDiscovery();
      if (!active || callState !== "idle") return;

      nsdSubscription?.remove();
      nsdSubscription = null;
      NativeModules.NsdDiscovery?.stop?.();
      discovery.stopDiscovery();

      const ownServiceName = `iTantra-${discovery.getDeviceId().slice(-8)}`;
      discovery.setDiscoveryPhase("nsd");

      nsdSubscription = DeviceEventEmitter.addListener(
        "itantraNsdDeviceFound",
        (device: NsdDevice) => {
          if (!active || callState !== "idle" || !device?.host || device.serviceName === ownServiceName) return;

          discovery.addDevice({
            id: device.serviceName,
            name: device.serviceName,
            ip: device.host,
            port: device.port || TCP_PORT,
            status: "available",
            lastSeen: Date.now(),
          });
          discovery.setDiscoveryPhase("nsd-found");
        },
      );

      try {
        NativeModules.NsdDiscovery?.start?.(
          discovery.getDeviceId(),
          discovery.getDeviceName(),
          TCP_PORT,
        );
      } catch {}
    };

    const refreshSubscription = DeviceEventEmitter.addListener(
      "itantraRefreshDiscovery",
      () => {
        if (!active || callState !== "idle") return;
        void startNsdDiscovery();
      },
    );

    if (callState !== "idle") {
      void stopDiscovery();
    }

    return () => {
      active = false;
      nsdSubscription?.remove();
      refreshSubscription.remove();
      void stopDiscovery();
      NativeModules.NsdDiscovery?.stop?.();
    };
  }, [callState]);

  return null;
}
