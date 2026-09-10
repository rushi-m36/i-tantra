import { Text, TouchableOpacity, View } from "react-native";
import "../../global.css";
import { useCommunication } from "../context/CommunicationContext";

export function IncomingCallModal() {
  const { incomingCallFrom, acceptCall, rejectCall, callState } = useCommunication();

  if (callState !== "incoming" || !incomingCallFrom) return null;

  return (
    <View className="absolute inset-0 items-center justify-center bg-black/85 px-6">
      <View style={{ width: "100%", maxWidth: 420, borderWidth: 1, borderColor: "#fff", backgroundColor: "#080808", paddingHorizontal: 28, paddingVertical: 32 }}>
        <View style={{ alignItems: "center", borderBottomWidth: 1, borderBottomColor: "#333", paddingBottom: 24 }}>
          <View style={{ marginBottom: 18, height: 64, width: 64, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#fff" }}>
            <Text style={{ fontSize: 26, fontWeight: "700", color: "#fff" }}>i</Text>
          </View>
          <Text style={{ fontSize: 11, fontWeight: "600", letterSpacing: 2, color: "#aaa", textTransform: "uppercase" }}>Incoming call</Text>
          <Text style={{ marginTop: 12, textAlign: "center", fontSize: 25, fontWeight: "700", color: "#fff" }}>{incomingCallFrom.name}</Text>
          <Text style={{ marginTop: 5, textAlign: "center", fontSize: 14, color: "#888" }}>wants to communicate with you</Text>
        </View>
        <View style={{ marginTop: 24, gap: 12 }}>
          <TouchableOpacity onPress={acceptCall} activeOpacity={0.8} style={{ height: 54, alignItems: "center", justifyContent: "center", backgroundColor: "#fff" }}>
            <Text style={{ fontSize: 15, fontWeight: "700", color: "#000" }}>Accept</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={rejectCall} activeOpacity={0.8} style={{ height: 54, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#fff", backgroundColor: "#080808" }}>
            <Text style={{ fontSize: 15, fontWeight: "600", color: "#fff" }}>Decline</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
