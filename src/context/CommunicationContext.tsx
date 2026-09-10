import React, { createContext, useCallback, useEffect, useState } from "react";
import * as Linking from "expo-linking";
import { DeviceDiscovery, getDeviceDiscovery, ScanStatus } from "../services/network/deviceDiscovery";
import { TCPService } from "../services/network/tcpService";
import { getSpeechToTextService } from "../services/speech/speechToText";
import { getTextToSpeechService } from "../services/speech/textToSpeech";
import { CallRequestMessage, CallState, ChatMessage, Device, Message, SpeechMessage } from "../types/communication";

const TCP_PORT = 5555;
const generateUUID = (): string => "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; const v = c === "x" ? r : (r & 0x3) | 0x8; return v.toString(16); });

interface CommunicationContextType {
  devices: Device[];
  scanStatus: ScanStatus;
  callState: CallState;
  messages: ChatMessage[];
  currentDevice: Device | null;
  localDeviceId: string;
  localDeviceName: string;
  isConnected: boolean;
  incomingCallFrom: Device | null;
  callDevice: (device: Device) => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => Promise<void>;
  endCall: () => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  startSpeechRecognition: () => Promise<void>;
  stopSpeechRecognition: () => Promise<void>;
  cleanup: () => Promise<void>;
}

export const CommunicationContext = createContext<CommunicationContextType | undefined>(undefined);

export function CommunicationProvider({ children }: { children: React.ReactNode }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [scanStatus, setScanStatus] = useState<ScanStatus>({ scanning: false, currentIp: null, scanned: 0, total: 0, found: 0 });
  const [callState, setCallState] = useState<CallState>("idle");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentDevice, setCurrentDevice] = useState<Device | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [incomingCallFrom, setIncomingCallFrom] = useState<Device | null>(null);
  const [tcp, setTcp] = useState<TCPService | null>(null);
  const [discovery, setDiscovery] = useState<DeviceDiscovery | null>(null);
  const [deviceId, setDeviceId] = useState("");
  const [deviceName, setDeviceName] = useState("");

  const handleIncomingMessage = useCallback((msg: Message, disc: DeviceDiscovery) => {
    switch (msg.type) {
      case "call_request": {
        const callReq = msg as CallRequestMessage;
        const caller: Device = { id: callReq.senderId, name: callReq.senderName, ip: "", port: TCP_PORT, status: "calling", lastSeen: Date.now() };
        setIncomingCallFrom(caller); setCurrentDevice(caller); setCallState("incoming");
        break;
      }
      case "call_accept": setCallState("connected"); setIncomingCallFrom(null); setMessages([]); break;
      case "call_reject":
        setCallState("rejected"); setIncomingCallFrom(null);
        setTimeout(() => { setCallState("idle"); setCurrentDevice(null); }, 1500);
        break;
      case "speech_message": {
        const speechMsg = msg as SpeechMessage;
        const senderName = speechMsg.senderId === disc.getDeviceId() ? "You (loopback)" : "Remote device";
        const chatMsg: ChatMessage = { id: speechMsg.id, senderId: speechMsg.senderId, senderName, text: speechMsg.text, timestamp: speechMsg.timestamp };
        setMessages((prev) => prev.some((item) => item.id === chatMsg.id) ? prev : [...prev, chatMsg]);
        void getTextToSpeechService().speak(speechMsg.text);
        break;
      }
      case "call_end": setCallState("idle"); setCurrentDevice(null); setIncomingCallFrom(null); setMessages([]); break;
      case "heartbeat": break;
    }
  }, []);

  useEffect(() => {
    let active = true;
    let localTcp: TCPService | null = null;
    let localDiscovery: DeviceDiscovery | null = null;
    const init = async () => {
      try {
        const disc = await getDeviceDiscovery();
        if (!active) return;
        localDiscovery = disc; setDiscovery(disc); setDeviceId(disc.getDeviceId()); setDeviceName(disc.getDeviceName());
        const tcpService = new TCPService(disc.getDeviceId()); localTcp = tcpService; setTcp(tcpService);
        disc.onDevicesChanged((newDevices) => { if (active) setDevices(newDevices); });
        disc.onScanStatusChanged((status) => { if (active) setScanStatus(status); });
        tcpService.onMessage((msg) => { if (active) handleIncomingMessage(msg, disc); });
        tcpService.onConnectionChange((connected) => { if (active) setIsConnected(connected); });
        disc.startDiscovery(); await tcpService.startServer();
      } catch (error) { console.error("Failed to initialize communication services:", error); }
    };
    void init();
    return () => { active = false; void localTcp?.cleanup(); localDiscovery?.cleanup(); };
  }, [handleIncomingMessage]);

  useEffect(() => {
    if (!tcp) return;
    const handleUrl = async (url: string | null) => {
      if (!url || !url.startsWith("itantra://incoming-call")) return;
      const parsed = Linking.parse(url);
      const ip = typeof parsed.queryParams?.ip === "string" ? parsed.queryParams.ip : "";
      const name = typeof parsed.queryParams?.name === "string" ? parsed.queryParams.name : "iTantra device";
      if (!ip) return;
      const remote: Device = { id: `remote-${ip}`, name, ip, port: TCP_PORT, status: "connected", lastSeen: Date.now() };
      try { setCurrentDevice(remote); setIncomingCallFrom(null); await tcp.connectToDevice(ip, TCP_PORT); setMessages([]); setCallState("connected"); }
      catch (error) { console.error("Failed to reconnect after accepting background call:", error); setCallState("idle"); setCurrentDevice(null); }
    };
    void Linking.getInitialURL().then(handleUrl);
    const subscription = Linking.addEventListener("url", ({ url }) => { void handleUrl(url); });
    return () => subscription.remove();
  }, [tcp]);

  const callDevice = useCallback(async (device: Device) => {
    if (!tcp || !device.ip) return;
    setCurrentDevice(device); setCallState("calling"); setIncomingCallFrom(null);
    try { await tcp.connectToDevice(device.ip, device.port || TCP_PORT); await tcp.sendMessage({ type: "call_request", senderId: deviceId, senderName: deviceName, timestamp: Date.now() }); }
    catch (error) { console.error("Failed to call device:", error); await tcp.disconnect(); setCallState("idle"); setCurrentDevice(null); }
  }, [tcp, deviceId, deviceName]);

  const acceptCall = useCallback(async () => {
    if (!tcp || !incomingCallFrom) return;
    try { await tcp.sendMessage({ type: "call_accept", senderId: deviceId, timestamp: Date.now() }); setCallState("connected"); setCurrentDevice(incomingCallFrom); setIncomingCallFrom(null); setMessages([]); }
    catch (error) { console.error("Failed to accept call:", error); }
  }, [tcp, incomingCallFrom, deviceId]);

  const rejectCall = useCallback(async () => {
    if (!tcp || !incomingCallFrom) return;
    try { await tcp.sendMessage({ type: "call_reject", senderId: deviceId, timestamp: Date.now() }); } catch (error) { console.error("Failed to reject call:", error); }
    await tcp.disconnect(); setCallState("idle"); setIncomingCallFrom(null); setCurrentDevice(null);
  }, [tcp, incomingCallFrom, deviceId]);

  const endCall = useCallback(async () => {
    if (!tcp) return;
    try { if (tcp.isConnected()) await tcp.sendMessage({ type: "call_end", senderId: deviceId, timestamp: Date.now() }); } catch (error) { console.error("Failed to send call_end:", error); }
    await tcp.disconnect(); setCallState("idle"); setCurrentDevice(null); setIncomingCallFrom(null); setMessages([]);
  }, [tcp, deviceId]);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim(); if (!tcp || !trimmed || !tcp.isConnected()) return;
    const msg: SpeechMessage = { type: "speech_message", id: generateUUID(), senderId: deviceId, text: trimmed, timestamp: Date.now() };
    await tcp.sendMessage(msg);
    setMessages((prev) => prev.some((item) => item.id === msg.id) ? prev : [...prev, { id: msg.id, senderId: deviceId, senderName: deviceName || "You", text: trimmed, timestamp: msg.timestamp }]);
  }, [tcp, deviceId, deviceName]);

  const startSpeechRecognition = useCallback(async () => { const text = await getSpeechToTextService().listenForSpeech(); if (text?.trim()) await sendMessage(text); }, [sendMessage]);
  const stopSpeechRecognition = useCallback(async () => { await getSpeechToTextService().stopListening(); }, []);
  const cleanup = useCallback(async () => { await tcp?.cleanup(); discovery?.cleanup(); await getSpeechToTextService().cleanup(); await getTextToSpeechService().cleanup(); }, [tcp, discovery]);

  return <CommunicationContext.Provider value={{ devices, scanStatus, callState, messages, currentDevice, localDeviceId: deviceId, localDeviceName: deviceName, isConnected, incomingCallFrom, callDevice, acceptCall, rejectCall, endCall, sendMessage, startSpeechRecognition, stopSpeechRecognition, cleanup }}>{children}</CommunicationContext.Provider>;
}

export function useCommunication() {
  const context = React.useContext(CommunicationContext);
  if (!context) throw new Error("useCommunication must be used within CommunicationProvider");
  return context;
}
