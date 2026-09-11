import { useEffect, useRef, useState } from "react";
import { Animated, Dimensions, Modal, Pressable, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import "../../global.css";
import { useCommunication } from "../context/CommunicationContext";
import { ChatMessage as ChatMessageType } from "../types/communication";

const BG = "#080808";
const FG = "#fff";
const MUTED = "#aaa";
const BORDER = "#2a2a2a";
const BUBBLE = "#2b2b2b";
const SCREEN_WIDTH = Dimensions.get("window").width;

export default function CommunicationScreen() {
  const { messages, currentDevice, localDeviceId, sendMessage, endCall, startSpeechRecognition, stopSpeechRecognition } = useCommunication();
  const [isListening, setIsListening] = useState(false);
  const [pressScale] = useState(new Animated.Value(1));
  const [messageText, setMessageText] = useState("");
  const [showTextInput, setShowTextInput] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);

  useEffect(() => { const timer = setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 50); return () => clearTimeout(timer); }, [messages.length]);
  const handleMicPress = async () => { setIsListening(true); Animated.spring(pressScale, { toValue: 0.92, useNativeDriver: true }).start(); try { await startSpeechRecognition(); } catch (error) { console.error("Speech recognition failed:", error); setIsListening(false); } };
  const handleMicRelease = async () => { setIsListening(false); Animated.spring(pressScale, { toValue: 1, useNativeDriver: true }).start(); try { await stopSpeechRecognition(); } catch (error) { console.error("Failed to stop speech recognition:", error); } };
  const handleSendMessage = async () => { const text = messageText.trim(); if (!text) return; try { await sendMessage(text); setMessageText(""); setShowTextInput(false); } catch (error) { console.error("Failed to send message:", error); } };

  return <View style={{ flex: 1, backgroundColor: BG }}>
    <View style={{ paddingHorizontal: 22, paddingTop: 48, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: BORDER }}><View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}><View style={{ flex: 1 }}><Text style={{ fontSize: 11, fontWeight: "700", letterSpacing: 2, color: MUTED }}>CONNECTED</Text><Text style={{ marginTop: 5, fontSize: 21, fontWeight: "700", color: FG }}>{currentDevice?.name || "Device"}</Text></View><TouchableOpacity onPress={endCall} activeOpacity={0.8} style={{ borderWidth: 1, borderColor: FG, borderRadius: 18, paddingHorizontal: 15, paddingVertical: 8 }}><Text style={{ fontWeight: "600", color: FG }}>End</Text></TouchableOpacity></View></View>
    <ScrollView ref={scrollViewRef} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 22, paddingBottom: 24 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}>
      {messages.length === 0 ? <View style={{ paddingHorizontal: 8, paddingTop: 30 }}><Text style={{ fontSize: 15, color: MUTED }}>No messages yet.</Text><Text style={{ marginTop: 5, fontSize: 13, color: "#777" }}>Hold the microphone below to speak.</Text></View> : messages.map((item: ChatMessageType, index) => {
        const safeItem: ChatMessageType = { id: typeof item?.id === "string" ? item.id : `message-${index}`, senderId: typeof item?.senderId === "string" ? item.senderId : "unknown", senderName: typeof item?.senderName === "string" ? item.senderName : "Unknown", text: typeof item?.text === "string" ? item.text : String(item?.text ?? ""), timestamp: typeof item?.timestamp === "number" ? item.timestamp : Date.now() };
        const own = safeItem.senderId === localDeviceId;
        return <View key={safeItem.id} style={{ marginBottom: 14, width: "100%" }}>
          <View style={{ width: "100%", alignItems: own ? "flex-end" : "flex-start" }}>
            <Text style={{ marginBottom: 5, fontSize: 10, fontWeight: "700", color: MUTED, textTransform: "uppercase", letterSpacing: 0.8 }}>{own ? "You" : safeItem.senderName}</Text>
            <View style={{ alignSelf: own ? "flex-end" : "flex-start", maxWidth: SCREEN_WIDTH * 0.82, backgroundColor: own ? BUBBLE : "#1d1d1d", borderRadius: 22, paddingHorizontal: 16, paddingVertical: 11, borderWidth: 1, borderColor: BORDER }}>
              <Text style={{ fontSize: 16, lineHeight: 23, color: FG, paddingRight: 4 }}>{safeItem.text}</Text>
            </View>
          </View>
        </View>;
      })}
    </ScrollView>
    <View style={{ borderTopWidth: 1, borderTopColor: BORDER, paddingHorizontal: 20, paddingTop: 15, paddingBottom: 28 }}><View style={{ alignItems: "center" }}><Pressable onPressIn={handleMicPress} onPressOut={handleMicRelease}><Animated.View style={{ width: 68, height: 68, borderRadius: 34, backgroundColor: FG, alignItems: "center", justifyContent: "center", transform: [{ scale: pressScale }] }}><View style={{ width: 17, height: 27, borderWidth: 2.5, borderColor: BG, borderRadius: 10 }} /><View style={{ position: "absolute", top: 35, width: 28, height: 15, borderBottomWidth: 2.5, borderLeftWidth: 2.5, borderRightWidth: 2.5, borderColor: BG, borderBottomLeftRadius: 14, borderBottomRightRadius: 14 }} /><View style={{ position: "absolute", top: 49, width: 3, height: 6, backgroundColor: BG, borderRadius: 2 }} /><View style={{ position: "absolute", top: 55, width: 15, height: 2.5, backgroundColor: BG, borderRadius: 2 }} /></Animated.View></Pressable><Text style={{ marginTop: 9, fontSize: 12, fontWeight: "600", color: MUTED }}>{isListening ? "Listening…" : "Hold to speak"}</Text><TouchableOpacity onPress={() => setShowTextInput(true)} activeOpacity={0.7} style={{ marginTop: 8, borderWidth: 1, borderColor: BORDER, borderRadius: 18, paddingHorizontal: 15, paddingVertical: 7 }}><Text style={{ fontSize: 12, color: FG }}>Type a message</Text></TouchableOpacity></View></View>
    <Modal visible={showTextInput} transparent animationType="fade" onRequestClose={() => setShowTextInput(false)}><View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.85)", padding: 20 }}><View style={{ width: "100%", maxWidth: 420, backgroundColor: BG, borderWidth: 1, borderColor: BORDER, borderRadius: 24, padding: 22 }}><Text style={{ fontSize: 20, fontWeight: "700", color: FG }}>Message</Text><TextInput autoFocus placeholder="Type your message" value={messageText} onChangeText={setMessageText} multiline placeholderTextColor="#777" style={{ marginTop: 16, minHeight: 100, borderWidth: 1, borderColor: BORDER, borderRadius: 18, padding: 14, color: FG, textAlignVertical: "top" }} /><View style={{ marginTop: 16, flexDirection: "row", gap: 10 }}><TouchableOpacity onPress={() => setShowTextInput(false)} activeOpacity={0.8} style={{ flex: 1, borderWidth: 1, borderColor: FG, borderRadius: 18, paddingVertical: 12 }}><Text style={{ textAlign: "center", fontWeight: "600", color: FG }}>Cancel</Text></TouchableOpacity><TouchableOpacity onPress={handleSendMessage} disabled={!messageText.trim()} activeOpacity={0.8} style={{ flex: 1, borderRadius: 18, backgroundColor: messageText.trim() ? FG : "#333", paddingVertical: 12 }}><Text style={{ textAlign: "center", fontWeight: "700", color: BG }}>Send</Text></TouchableOpacity></View></View></View></Modal>
  </View>;
}
