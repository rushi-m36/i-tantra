import { useEffect } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useCommunication } from "../context/CommunicationContext";

export default function IncomingCallRoute() {
  const { callState } = useCommunication();

  useEffect(() => {
    if (callState === "connected") {
      router.replace("/communication");
    } else if (callState === "idle" || callState === "disconnected" || callState === "rejected") {
      router.replace("/");
    }
  }, [callState]);

  return <View style={{ flex: 1, backgroundColor: "#080808" }} />;
}
