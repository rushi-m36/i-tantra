import { useRouter } from "expo-router";
import { useEffect } from "react";
import { DeviceEventEmitter, Text, TouchableOpacity, View } from "react-native";
import "../../global.css";
import { BottomNav } from "../components/BottomNav";
import { IncomingCallModal } from "../components/IncomingCallModal";
import { useCommunication } from "../context/CommunicationContext";
import AvailableDevicesScreen from "../screens/AvailableDevicesScreen";
import CommunicationScreen from "../screens/CommunicationScreen";

export default function App() {
  const router = useRouter();
  const { callState, scanStatus, refreshDiscovery } = useCommunication();

  useEffect(() => {
    if (callState === "connected") {
      router.replace("/communication");
    }
  }, [callState, router]);

  const handleStartScanning = () => {
    if (scanStatus.scanning || callState !== "idle") return;
    refreshDiscovery();
    setTimeout(() => DeviceEventEmitter.emit("itantraRefreshDiscovery"), 0);
  };

  if (callState === "connected") {
    return <CommunicationScreen />;
  }

  const isScanning = scanStatus.phase === "nsd";
  const showStartButton = callState === "idle" && scanStatus.phase === "idle";

  return (
    <View style={{ flex: 1, backgroundColor: "#080808" }}>
      <View style={{ flex: 1 }}>
        <AvailableDevicesScreen />
        {showStartButton && (
          <View style={{ paddingHorizontal: 24, paddingBottom: 12 }}>
            <TouchableOpacity
              onPress={handleStartScanning}
              activeOpacity={0.8}
              style={{ height: 48, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: "#fff" }}
            >
              <Text style={{ fontSize: 14, fontWeight: "600", color: "#000" }}>Start scanning for nearby devices</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
      <BottomNav />
      <IncomingCallModal />
    </View>
  );
}
