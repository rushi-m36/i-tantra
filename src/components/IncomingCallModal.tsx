import { Text, TouchableOpacity, View } from "react-native";
import "../../global.css";
import { useCommunication } from "../context/CommunicationContext";

export function IncomingCallModal() {
  const { incomingCallFrom, acceptCall, rejectCall, callState } = useCommunication();

  if (callState !== "incoming" || !incomingCallFrom) return null;

  return (
    <View className="absolute inset-0 items-center justify-center bg-black/60 px-6">
      <View className="w-full max-w-md border border-black bg-white px-7 py-8">
        <View className="items-center border-b border-gray-200 pb-6">
          <View className="mb-5 h-16 w-16 items-center justify-center rounded-full bg-black">
            <Text className="text-2xl font-bold text-white">i</Text>
          </View>
          <Text className="text-xs font-semibold uppercase tracking-widest text-gray-500">
            Incoming call
          </Text>
          <Text className="mt-3 text-center text-2xl font-bold text-black">
            {incomingCallFrom.name}
          </Text>
          <Text className="mt-1 text-center text-base text-gray-600">
            wants to communicate with you
          </Text>
        </View>

        <View className="mt-6 gap-3">
          <TouchableOpacity
            onPress={acceptCall}
            activeOpacity={0.8}
            className="h-14 items-center justify-center bg-black"
          >
            <Text className="text-base font-semibold text-white">Accept</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={rejectCall}
            activeOpacity={0.8}
            className="h-14 items-center justify-center border border-black bg-white"
          >
            <Text className="text-base font-semibold text-black">Decline</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
