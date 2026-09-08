import { Text, TouchableOpacity, View } from "react-native";
import "../../global.css";
import { useCommunication } from "../context/CommunicationContext";

export function IncomingCallModal() {
  const { incomingCallFrom, acceptCall, rejectCall, callState } =
    useCommunication();

  if (callState !== "incoming" || !incomingCallFrom) {
    return null;
  }

  return (
    <View className="absolute inset-0 flex-1 items-center justify-center bg-black bg-opacity-50">
      <View className="w-4/5 rounded-2xl bg-white p-8">
        <Text className="text-center text-2xl font-bold text-gray-900">
          {incomingCallFrom.name}
        </Text>
        <Text className="mt-2 text-center text-lg text-gray-600">
          is calling...
        </Text>

        <View className="mt-8 flex-row justify-around">
          <TouchableOpacity
            onPress={rejectCall}
            className="rounded-full bg-red-500 p-4"
          >
            <Text className="text-3xl">❌</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={acceptCall}
            className="rounded-full bg-green-500 p-4"
          >
            <Text className="text-3xl">✓</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
