import { useRouter } from "expo-router";
import { useEffect } from "react";
import { ScrollView, Text, View } from "react-native";
import "../../global.css";
import { BottomNav } from "../components/BottomNav";
import { useCommunication } from "../context/CommunicationContext";

export default function Guide() {
  const router = useRouter();
  const { callState } = useCommunication();

  useEffect(() => {
    if (callState !== "idle" && callState !== "incoming") {
      router.replace("/communication");
    }
  }, [callState, router]);

  return (
    <View style={{ flex: 1, backgroundColor: "#080808" }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 64, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
        <Text style={{ fontSize: 11, fontWeight: "600", letterSpacing: 2, color: "#aaa", textTransform: "uppercase" }}>iTantra</Text>
        <Text style={{ marginTop: 8, fontSize: 30, fontWeight: "700", color: "#fff" }}>Guide</Text>

        <View style={{ marginTop: 28 }}>
          <Text style={{ fontSize: 18, fontWeight: "700", color: "#fff" }}>What is iTantra?</Text>
          <Text style={{ marginTop: 10, fontSize: 15, lineHeight: 23, color: "#aaa" }}>
            iTantra is an offline communication app designed for low connectivity environments. It lets nearby devices communicate over a local Wi-Fi network without requiring the internet.
          </Text>
        </View>

        <View style={{ marginTop: 28, borderTopWidth: 1, borderColor: "#2a2a2a" }}>
          <Text style={{ marginTop: 20, fontSize: 18, fontWeight: "700", color: "#fff" }}>How to use it</Text>

          <View style={{ marginTop: 20 }}>
            <Text style={{ fontSize: 13, fontWeight: "600", color: "#fff" }}>1. Connect to the same Wi-Fi</Text>
            <Text style={{ marginTop: 5, fontSize: 14, lineHeight: 21, color: "#888" }}>Connect both devices to the same Wi-Fi hotspot or local network.</Text>
          </View>

          <View style={{ marginTop: 18 }}>
            <Text style={{ fontSize: 13, fontWeight: "600", color: "#fff" }}>2. Find a device</Text>
            <Text style={{ marginTop: 5, fontSize: 14, lineHeight: 21, color: "#888" }}>iTantra automatically looks for nearby iTantra devices on the network.</Text>
          </View>

          <View style={{ marginTop: 18 }}>
            <Text style={{ fontSize: 13, fontWeight: "600", color: "#fff" }}>3. Start a call</Text>
            <Text style={{ marginTop: 5, fontSize: 14, lineHeight: 21, color: "#888" }}>Tap Call beside a device to start communication. You can cancel while the connection is being established.</Text>
          </View>

          <View style={{ marginTop: 18 }}>
            <Text style={{ fontSize: 13, fontWeight: "600", color: "#fff" }}>4. Speak naturally</Text>
            <Text style={{ marginTop: 5, fontSize: 14, lineHeight: 21, color: "#888" }}>Use your voice to send speech. iTantra converts speech to text and uses text to speech for the other device.</Text>
          </View>
        </View>

        <View style={{ marginTop: 28, borderTopWidth: 1, borderColor: "#2a2a2a", paddingTop: 20 }}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: "#fff" }}>No internet required</Text>
          <Text style={{ marginTop: 5, fontSize: 14, lineHeight: 21, color: "#888" }}>Communication stays on the local network between connected devices.</Text>
        </View>
      </ScrollView>
      <BottomNav />
    </View>
  );
}
