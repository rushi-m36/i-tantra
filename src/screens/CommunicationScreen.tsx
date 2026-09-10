import { useEffect, useRef, useState } from "react";
import { Animated, Modal, Pressable, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import "../../global.css";
import { useCommunication } from "../context/CommunicationContext";
import { ChatMessage as ChatMessageType } from "../types/communication";

export default function CommunicationScreen() {
  const { messages, currentDevice, localDeviceId, sendMessage, endCall, startSpeechRecognition, stopSpeechRecognition } = useCommunication();
  const [isListening, setIsListening] = useState(false);
  const [pressScale] = useState(new Animated.Value(1));
  const [messageText, setMessageText] = useState("");
  const [showTextInput, setShowTextInput] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    const timer = setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(timer);
  }, [messages.length]);

  const handleMicPress = async () => {
    setIsListening(true);
    Animated.spring(pressScale, { toValue: 0.9, useNativeDriver: true }).start();
    try { await startSpeechRecognition(); } catch (error) { console.error("Speech recognition failed:", error); setIsListening(false); }
  };

  const handleMicRelease = async () => {
    setIsListening(false);
    Animated.spring(pressScale, { toValue: 1, useNativeDriver: true }).start();
    try { await stopSpeechRecognition(); } catch (error) { console.error("Failed to stop speech recognition:", error); }
  };

  const handleSendMessage = async () => {
    const text = messageText.trim();
    if (!text) return;
    try { await sendMessage(text); setMessageText(""); setShowTextInput(false); } catch (error) { console.error("Failed to send message:", error); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      <View style={{ paddingHorizontal: 24, paddingTop: 48, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: "#000" }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 11, fontWeight: "700", letterSpacing: 2, color: "#666" }}>CONNECTED</Text>
            <Text style={{ marginTop: 5, fontSize: 21, fontWeight: "700", color: "#000" }}>{currentDevice?.name || "Device"}</Text>
          </View>
          <TouchableOpacity onPress={endCall} activeOpacity={0.8} style={{ borderWidth: 1, borderColor: "#000", paddingHorizontal: 14, paddingVertical: 9 }}>
            <Text style={{ fontWeight: "600", color: "#000" }}>End</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView ref={scrollViewRef} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 24, paddingVertical: 20 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}>
        {messages.length === 0 ? (
          <View style={{ paddingTop: 30 }}>
            <Text style={{ fontSize: 15, color: "#777" }}>No messages yet.</Text>
            <Text style={{ marginTop: 5, fontSize: 13, color: "#999" }}>Hold the button below to speak.</Text>
          </View>
        ) : messages.map((item: ChatMessageType, index) => {
          const safeItem: ChatMessageType = {
            id: typeof item?.id === "string" ? item.id : `message-${index}`,
            senderId: typeof item?.senderId === "string" ? item.senderId : "unknown",
            senderName: typeof item?.senderName === "string" ? item.senderName : "Unknown",
            text: typeof item?.text === "string" ? item.text : String(item?.text ?? ""),
            timestamp: typeof item?.timestamp === "number" ? item.timestamp : Date.now(),
          };
          const own = safeItem.senderId === localDeviceId;
          return (
            <View key={safeItem.id} style={{ marginBottom: 20, borderBottomWidth: 1, borderBottomColor: "#eee", paddingBottom: 14 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 5 }}>
                <Text style={{ fontSize: 11, fontWeight: "700", color: own ? "#000" : "#666", textTransform: "uppercase" }}>{own ? "You" : safeItem.senderName}</Text>
                <Text style={{ fontSize: 10, color: "#999" }}>{new Date(safeItem.timestamp).toLocaleTimeString()}</Text>
              </View>
              <Text style={{ fontSize: 16, lineHeight: 23, color: "#000" }}>{safeItem.text}</Text>
            </View>
          );
        })}
      </ScrollView>

      <View style={{ borderTopWidth: 1, borderTopColor: "#000", paddingHorizontal: 24, paddingTop: 18, paddingBottom: 30 }}>
        <View style={{ alignItems: "center" }}>
          <Pressable onPressIn={handleMicPress} onPressOut={handleMicRelease}>
            <Animated.View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: "#000", alignItems: "center", justifyContent: "center", transform: [{ scale: pressScale }] }}>
              <View style={{ width: 18, height: 28, borderWidth: 2, borderColor: "#fff", borderRadius: 10 }} />
              <View style={{ position: "absolute", bottom: 15, width: 28, height: 12, borderBottomWidth: 2, borderColor: "#fff", borderRadius: 10 }} />
            </Animated.View>
          </Pressable>
          <Text style={{ marginTop: 10, fontSize: 13, fontWeight: "600", color: "#000" }}>{isListening ? "Listening" : "Hold to speak"}</Text>
          <TouchableOpacity onPress={() => setShowTextInput(true)} style={{ marginTop: 7 }}>
            <Text style={{ fontSize: 12, color: "#555", textDecorationLine: "underline" }}>Type a message</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Modal visible={showTextInput} transparent animationType="fade" onRequestClose={() => setShowTextInput(false)}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.6)", padding: 24 }}>
          <View style={{ width: "100%", maxWidth: 420, backgroundColor: "#fff", borderWidth: 1, borderColor: "#000", padding: 24 }}>
            <Text style={{ fontSize: 20, fontWeight: "700", color: "#000" }}>Message</Text>
            <TextInput autoFocus placeholder="Type your message" value={messageText} onChangeText={setMessageText} multiline placeholderTextColor="#888" style={{ marginTop: 16, minHeight: 100, borderWidth: 1, borderColor: "#ccc", padding: 12, color: "#000", textAlignVertical: "top" }} />
            <View style={{ marginTop: 16, flexDirection: "row", gap: 10 }}>
              <TouchableOpacity onPress={() => setShowTextInput(false)} style={{ flex: 1, borderWidth: 1, borderColor: "#000", paddingVertical: 12 }}>
                <Text style={{ textAlign: "center", fontWeight: "600", color: "#000" }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleSendMessage} disabled={!messageText.trim()} style={{ flex: 1, backgroundColor: messageText.trim() ? "#000" : "#ccc", paddingVertical: 12 }}>
                <Text style={{ textAlign: "center", fontWeight: "600", color: "#fff" }}>Send</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
