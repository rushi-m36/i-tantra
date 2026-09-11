import { useRouter } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";
import "../../global.css";
import { BottomNav } from "../components/BottomNav";
import { IncomingCallModal } from "../components/IncomingCallModal";
import { useCommunication } from "../context/CommunicationContext";
import AvailableDevicesScreen from "../screens/AvailableDevicesScreen";
import CommunicationScreen from "../screens/CommunicationScreen";

export default function App() {
  const router = useRouter();
  const { callState } = useCommunication();

  useEffect(() => {
    if (callState === "connected") {
      router.replace("/communication");
    }
  }, [callState, router]);

  if (callState === "connected") {
    return <CommunicationScreen />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#080808" }}>
      <View style={{ flex: 1 }}>
        <AvailableDevicesScreen />
      </View>
      <BottomNav />
      <IncomingCallModal />
    </View>
  );
}
