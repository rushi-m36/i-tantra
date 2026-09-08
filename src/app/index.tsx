import { useRouter } from "expo-router";
import { useEffect } from "react";
import "../../global.css";
import { IncomingCallModal } from "../components/IncomingCallModal";
import { useCommunication } from "../context/CommunicationContext";
import AvailableDevicesScreen from "../screens/AvailableDevicesScreen";
import CommunicationScreen from "../screens/CommunicationScreen";

export default function App() {
  const router = useRouter();
  const { callState } = useCommunication();

  useEffect(() => {
    if (callState === "connected") {
      router.push("/communication");
    } else if (callState === "idle" && router.canGoBack()) {
      router.back();
    }
  }, [callState, router]);

  return (
    <>
      {callState === "connected" ? (
        <CommunicationScreen />
      ) : (
        <AvailableDevicesScreen />
      )}
      <IncomingCallModal />
    </>
  );
}
