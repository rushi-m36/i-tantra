import { useState } from "react";
import { Animated, Modal, Pressable, Text, TextInput, TouchableOpacity, View } from "react-native";
import "../../global.css";
import { useCommunication } from "../context/CommunicationContext";
import { ChatMessage as ChatMessageType } from "../types/communication";

export default function CommunicationScreen() {
  const {
    messages,
    currentDevice,
    localDeviceId,
    sendMessage,
    endCall,
    startSpeechRecognition,
    stopSpeechRecognition,
  } = useCommunication();
  const [isListening, setIsListening] = useState(false);
  const [pressScale] = useState(new Animated.Value(1));
  const [messageText, setMessageText] = useState("");
  const [showTextInput, setShowTextInput] = useState(false);

  const handleMicPress = async () => {
    setIsListening(true);
    Animated.spring(pressScale, { toValue: 0.8, useNativeDriver: true }).start();
    try {
      await startSpeechRecognition();
    } catch (error) {
      console.error("Speech recognition failed:", error);
    }
  };

  const handleMicRelease = async () => {
    setIsListening(false);
    Animated.spring(pressScale, { toValue: 1, useNativeDriver: true }).start();
    try {
      await stopSpeechRecognition();
    } catch (error) {
      console.error("Failed to stop speech recognition:", error);
    }
  };

  const handleSendMessage = async () => {
    if (!messageText.trim()) return;
    try {
      await sendMessage(messageText);
      setMessageText("");
      setShowTextInput(false);
    } catch (error) {
      console.error("Failed to send message:", error);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      <View
        style={{
          borderBottomWidth: 1,
          borderBottomColor: "#e5e7eb",
          backgroundColor: "#f9fafb",
          paddingHorizontal: 24,
          paddingTop: 48,
          paddingBottom: 16,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View>
            <Text style={{ fontSize: 18, fontWeight: "700", color: "#111827" }}>
              {currentDevice?.name || "Connected"}
            </Text>
            <Text style={{ fontSize: 14, color: "#16a34a", marginTop: 2 }}>Connected</Text>
          </View>
          <TouchableOpacity
            onPress={endCall}
            style={{ backgroundColor: "#ef4444", borderRadius: 8, paddingHorizontal: 16, paddingVertical: 9 }}
          >
            <Text style={{ fontWeight: "600", color: "#fff" }}>End Call</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={{ flex: 1, padding: 12 }}>
        {messages.map((item: ChatMessageType, index) => {
          const safeItem: ChatMessageType = {
            id: typeof item?.id === "string" ? item.id : `message-${index}`,
            senderId: typeof item?.senderId === "string" ? item.senderId : "unknown",
            senderName: typeof item?.senderName === "string" ? item.senderName : "Unknown",
            text: typeof item?.text === "string" ? item.text : String(item?.text ?? ""),
            timestamp: typeof item?.timestamp === "number" ? item.timestamp : Date.now(),
          };
          const own = safeItem.senderId === localDeviceId;

          return (
            <View
              key={safeItem.id}
              style={{
                marginBottom: 12,
                flexDirection: "row",
                justifyContent: own ? "flex-end" : "flex-start",
              }}
            >
              <View
                style={{
                  maxWidth: "80%",
                  borderRadius: 10,
                  paddingHorizontal: 12,
                  paddingVertical: 9,
                  backgroundColor: own ? "#3b82f6" : "#e5e7eb",
                }}
              >
                {!own && (
                  <Text style={{ fontSize: 12, fontWeight: "600", color: "#4b5563", marginBottom: 2 }}>
                    {safeItem.senderName}
                  </Text>
                )}
                <Text style={{ color: own ? "#fff" : "#111827", fontSize: 15 }}>
                  {safeItem.text}
                </Text>
                <Text
                  style={{
                    marginTop: 4,
                    fontSize: 11,
                    color: own ? "#dbeafe" : "#6b7280",
                  }}
                >
                  {new Date(safeItem.timestamp).toLocaleTimeString()}
                </Text>
              </View>
            </View>
          );
        })}
      </View>

      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: "#e5e7eb",
          backgroundColor: "#fff",
          paddingTop: 20,
          paddingBottom: 32,
          alignItems: "center",
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Pressable onPressIn={handleMicPress} onPressOut={handleMicRelease}>
            <Animated.View
              style={{
                width: 80,
                height: 80,
                borderRadius: 40,
                backgroundColor: isListening ? "#dc2626" : "#3b82f6",
                alignItems: "center",
                justifyContent: "center",
                transform: [{ scale: pressScale }],
              }}
            >
              <Text style={{ fontSize: 30 }}>🎙️</Text>
            </Animated.View>
          </Pressable>

          <View style={{ marginLeft: 16 }}>
            <Text style={{ fontSize: 14, fontWeight: "600", color: "#111827" }}>
              {isListening ? "Listening…" : "Hold to speak"}
            </Text>
            <Text style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
              Native Android speech recognition
            </Text>
            <TouchableOpacity onPress={() => setShowTextInput(true)} style={{ marginTop: 6 }}>
              <Text style={{ fontSize: 12, color: "#2563eb" }}>Use text fallback</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <Modal visible={showTextInput} transparent animationType="slide" onRequestClose={() => setShowTextInput(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", padding: 24, paddingTop: 128 }}>
          <View style={{ borderRadius: 10, backgroundColor: "#fff", padding: 24 }}>
            <Text style={{ fontSize: 20, fontWeight: "700", color: "#111827" }}>Send Message</Text>
            <Text style={{ marginTop: 4, fontSize: 14, color: "#6b7280" }}>
              Manual fallback if speech recognition is unavailable.
            </Text>
            <TextInput
              autoFocus
              placeholder="Type your message..."
              value={messageText}
              onChangeText={setMessageText}
              multiline
              numberOfLines={4}
              placeholderTextColor="#999"
              style={{
                marginTop: 16,
                minHeight: 100,
                borderWidth: 1,
                borderColor: "#d1d5db",
                borderRadius: 8,
                padding: 12,
                color: "#111827",
                textAlignVertical: "top",
              }}
            />
            <View style={{ marginTop: 20, flexDirection: "row", justifyContent: "flex-end", gap: 12 }}>
              <TouchableOpacity
                onPress={() => setShowTextInput(false)}
                style={{ backgroundColor: "#d1d5db", borderRadius: 8, paddingHorizontal: 16, paddingVertical: 9 }}
              >
                <Text style={{ fontWeight: "600", color: "#111827" }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSendMessage}
                disabled={!messageText.trim()}
                style={{
                  backgroundColor: messageText.trim() ? "#3b82f6" : "#d1d5db",
                  borderRadius: 8,
                  paddingHorizontal: 16,
                  paddingVertical: 9,
                }}
              >
                <Text style={{ fontWeight: "600", color: "#fff" }}>Send</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
