import { useEffect } from "react";
import { getDeviceDiscovery } from "../services/network/deviceDiscovery";
import { useCommunication } from "../context/CommunicationContext";

export function DiscoveryLifecycle() {
  const { callState } = useCommunication();

  useEffect(() => {
    let active = true;
    void getDeviceDiscovery().then((discovery) => {
      if (!active) return;
      if (callState === "calling" || callState === "incoming" || callState === "connected") {
        discovery.stopDiscovery();
      } else if (callState === "idle") {
        discovery.startDiscovery();
      }
    });
    return () => {
      active = false;
    };
  }, [callState]);

  return null;
}
