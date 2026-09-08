import { useState } from "react";
import { Animated, FlatList, Modal, Text, TextInput, TouchableOpacity, View } from "react-native";
import "../../global.css";
import { useCommunication } from "../context/CommunicationContext";
import { ChatMessage as ChatMessageType } from "../types/communication";

function ChatMessage({ message, isOwn }: { message: ChatMessageType; isOwn: boolean }) {
  const time = new Date(message.timestamp).toLocaleTimeString();
  return (
    <View className={`mb-3 flex-row ${isOwn ? "justify-end" : "justify-start"}`}>
      <View className={`max-w-xs rounded-lg px-3 py-2 ${isOwn ? "bg-blue-500" : "bg-gray-200"}`}>
        {!isOwn && <Text className="text-xs font-semibold text-gray-600">{message.senderName}</Text>}
        <Text className={isOwn ? "text-white" : "text-gray-900"}>{message.text}</Text>
        <Text className={`mt-1 text-xs ${isOwn ? "text-blue-100" : "text-gray-600"}`}>{time}</Text>
      </View>
    </View>
  );
}

export default function CommunicationScreen() {
  const { messages, currentDevice, localDeviceId, sendMessage, endCall } = useCommunication();
  const [isListening, setIsListening] = useState(false);
  const [pressScale] = useState(new Animated.Value(1));
  const [messageText, setMessageText] = useState("");
  const [showTextInput, setShowTextInput] = useState(false);

  const handleMicPress = () => {
    setShowTextInput(true);
    setIsListening(true);
    Animated.spring(pressScale, { toValue: 0.8, useNativeDriver: true }).start();
  };

  const handleMicRelease = () => {
    setIsListening(false);
    Animated.spring(pressScale, { toValue: 1, useNativeDriver: true }).start();
  };

  const handleSendMessage = async () => {
    if (!messageText.trim()) return;
    try {
      await sendMessage(messageText);
      setMessageText("");
      setShowTextInput(false);
      setIsListening(false);
    } catch (error) {
      console.error("Failed to send message:", error);
    }
  };

  const handleCancelInput = () => {
    setMessageText("");
    setShowTextInput(false);
    setIsListening(false);
  };

  return (
    <View className="flex-1 bg-white">
      <View className="border-b border-gray-200 bg-gray-50 px-6 py-4 pt-12">
        <View className="flex-row items-center justify-between">
          <View>
            <Text className="text-lg font-bold text-gray-900">{currentDevice?.name || "Connected"}</Text>
            <Text className="text-sm text-green-600">Connected</Text>
          </View>
          <TouchableOpacity onPress={endCall} className="rounded-lg bg-red-500 px-4 py-2">
            <Text className="font-semibold text-white">End Call</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <ChatMessage message={item} isOwn={item.senderId === localDeviceId} />}
        contentContainerStyle={{ padding: 12, paddingBottom: 120 }}
      />

      <View className="absolute bottom-0 left-0 right-0 flex-row items-center justify-center border-t border-gray-200 bg-white pb-8 pt-6">
        <TouchableOpacity onPressIn={handleMicPress} onPressOut={handleMicRelease} activeOpacity={0.8}>
          <Animated.View style={{ transform: [{ scale: pressScale }] }} className="h-20 w-20 items-center justify-center rounded-full bg-blue-500">
            <Text className="text-3xl">🎙️</Text>
          </Animated.View>
        </TouchableOpacity>
        <View className="ml-4">
          <Text className="text-sm font-semibold text-gray-900">Hold to compose</Text>
          <Text className="text-xs text-gray-500">Text fallback for MVP testing</Text>
        </View>
      </View>

      <Modal visible={showTextInput} transparent animationType="slide" onRequestClose={handleCancelInput}>
        <View className="flex-1 bg-black/50 p-6 pt-32">
          <View className="rounded-lg bg-white p-6">
            <Text className="text-xl font-bold text-gray-900">Send Message</Text>
            <Text className="mt-1 text-sm text-gray-500">This tests TCP + receiver TTS while native STT is added.</Text>
            <TextInput autoFocus placeholder="Type your message..." value={messageText} onChangeText={setMessageText} multiline numberOfLines={4} className="mt-4 rounded-lg border border-gray-300 p-3 text-gray-900" placeholderTextColor="#999" />
            <View className="mt-6 flex-row justify-end gap-3">
              <TouchableOpacity onPress={handleCancelInput} className="rounded-lg bg-gray-300 px-4 py-2"><Text className="font-semibold text-gray-900">Cancel</Text></TouchableOpacity>
              <TouchableOpacity onPress={handleSendMessage} disabled={!messageText.trim()} className={`rounded-lg px-4 py-2 ${messageText.trim() ? "bg-blue-500" : "bg-gray-300"}`}><Text className="font-semibold text-white">Send</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
