import { Text, TouchableOpacity, View } from "react-native";
import "../../global.css";
import { useCommunication } from "../context/CommunicationContext";

export function IncomingCallModal() {
  const { incomingCallFrom, acceptCall, rejectCall, callState } = useCommunication();

  if (callState !== "incoming" || !incomingCallFrom) return null;

  return (
    <View className="absolute inset-0 items-center justify-center bg-black/85 px-6">
      <View style={{ width: "100%", maxWidth: 420, borderWidth: 1, borderColor: "#333", borderRadius: 28, backgroundColor: "#080808", paddingHorizontal: 24, paddingVertical: 28 }}>
        <View style={{ alignItems: "center", paddingBottom: 22 }}>
          <View style={{ marginBottom: 18, height: 68, width: 68, alignItems: "center", justifyContent: "center", borderRadius: 34, backgroundColor: "#fff" }}>
            <View style={{ width: 17, height: 27, borderWidth: 2.5, borderColor: "#080808", borderRadius: 10 }} />
            <View style={{ position: "absolute", top: 37, width: 29, height: 14, borderBottomWidth: 2.5, borderLeftWidth: 2.5, borderRightWidth: 2.5, borderColor: "#080808", borderBottomLeftRadius: 14, borderBottomRightRadius: 14 }} />
            <View style={{ position: "absolute", top: 51, width: 3, height: 6, backgroundColor: "#080808", borderRadius: 2 }} />
            <View style={{ position: "absolute", top: 57, width: 15, height: 2.5, backgroundColor: "#080808", borderRadius: 2 }} />
          </View>
          <Text style={{ fontSize: 11, fontWeight: "600", letterSpacing: 2, color: "#aaa", textTransform: "uppercase" }}>Incoming call</Text>
          <Text style={{ marginTop: 10, textAlign: "center", fontSize: 25, fontWeight: "700", color: "#fff" }}>{incomingCallFrom.name}</Text>
          <Text style={{ marginTop: 5, textAlign: "center", fontSize: 14, color: "#888" }}>wants to communicate with you</Text>
        </View>
        <View style={{ borderTopWidth: 1, borderTopColor: "#2a2a2a", paddingTop: 22, gap: 10 }}>
          <TouchableOpacity onPress={acceptCall} activeOpacity={0.8} style={{ height: 52, alignItems: "center", justifyContent: "center", borderRadius: 26, backgroundColor: "#fff" }}>
            <Text style={{ fontSize: 15, fontWeight: "700", color: "#000" }}>Accept</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={rejectCall} activeOpacity={0.8} style={{ height: 52, alignItems: "center", justifyContent: "center", borderRadius: 26, borderWidth: 1, borderColor: "#555", backgroundColor: "#080808" }}>
            <Text style={{ fontSize: 15, fontWeight: "600", color: "#fff" }}>Decline</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
