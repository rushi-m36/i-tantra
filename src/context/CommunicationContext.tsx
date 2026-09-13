import React, { createContext, useCallback, useEffect, useRef, useState } from "react";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import { DeviceDiscovery, getDeviceDiscovery, ScanStatus } from "../services/network/deviceDiscovery";
import { TCPService } from "../services/network/tcpService";
import { getSpeechToTextService } from "../services/speech/speechToText";
import { getTextToSpeechService } from "../services/speech/textToSpeech";
import { CallRequestMessage, CallState, ChatMessage, Device, Message, SpeechMessage } from "../types/communication";

const TCP_PORT = 5555;
const RECONNECT_ATTEMPTS = 12;
const RECONNECT_DELAY = 400;
const INCOMING_CALL_DEDUPE_MS = 30000;
const handledIncomingCallUrls = new Map<string, number>();
const generateUUID: () => string = () => "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => { const r = (Math.random() * 16) | 0; const v = c === "x" ? r : (r & 3) | 8; return v.toString(16); });

async function connectWithRetry(service: TCPService, ip: string, port: number): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= RECONNECT_ATTEMPTS; attempt++) {
    try { await service.connectToDevice(ip, port); return; }
    catch (error) { lastError = error; if (attempt < RECONNECT_ATTEMPTS) await new Promise(resolve => setTimeout(resolve, RECONNECT_DELAY + (attempt - 1) * 100)); }
  }
  throw lastError instanceof Error ? lastError : new Error("TCP reconnect failed");
}

interface CommunicationContextType {
  devices: Device[]; scanStatus: ScanStatus; callState: CallState; messages: ChatMessage[]; currentDevice: Device | null; localDeviceId: string; localDeviceName: string; isConnected: boolean; incomingCallFrom: Device | null;
  callDevice: (device: Device) => Promise<void>; cancelCall: () => Promise<void>; acceptCall: () => Promise<void>; rejectCall: () => Promise<void>; endCall: () => Promise<void>; refreshDiscovery: () => void; sendMessage: (text: string) => Promise<void>; startSpeechRecognition: () => Promise<void>; stopSpeechRecognition: () => Promise<void>; cleanup: () => Promise<void>;
}
export const CommunicationContext = createContext<CommunicationContextType | undefined>(undefined);

export function CommunicationProvider({ children }: { children: React.ReactNode }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [scanStatus, setScanStatus] = useState<ScanStatus>({ scanning: false, currentIp: null, scanned: 0, total: 0, found: 0, phase: "idle" });
  const [callState, setCallState] = useState<CallState>("idle");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentDevice, setCurrentDevice] = useState<Device | null>(null);
  const currentDeviceRef = useRef<Device | null>(null);
  const callStateRef = useRef<CallState>("idle");
  const [isConnected, setIsConnected] = useState(false);
  const [incomingCallFrom, setIncomingCallFrom] = useState<Device | null>(null);
  const [tcp, setTcp] = useState<TCPService | null>(null);
  const tcpRef = useRef<TCPService | null>(null);
  const [discovery, setDiscovery] = useState<DeviceDiscovery | null>(null);
  const [deviceId, setDeviceId] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const autoConnecting = useRef(false);

  useEffect(() => { currentDeviceRef.current = currentDevice; }, [currentDevice]);
  useEffect(() => { callStateRef.current = callState; }, [callState]);

  const handleIncomingMessage = useCallback(async (msg: Message, disc: DeviceDiscovery) => {
    switch (msg.type) {
      case "call_request": { const callReq = msg as CallRequestMessage; const caller: Device = { id: callReq.senderId, name: callReq.senderName, ip: "", port: TCP_PORT, status: "calling", lastSeen: Date.now() }; currentDeviceRef.current = caller; setIncomingCallFrom(caller); setCurrentDevice(caller); setCallState("incoming"); break; }
      case "call_accept": { setCallState("connected"); setIncomingCallFrom(null); setMessages([]); const peer = currentDeviceRef.current; const service = tcpRef.current; if (peer?.ip && service) { try { await new Promise(resolve => setTimeout(resolve, 300)); await connectWithRetry(service, peer.ip, peer.port || TCP_PORT); } catch { setCallState("disconnected"); } } break; }
      case "call_reject": setCallState("rejected"); setIncomingCallFrom(null); setTimeout(() => { setCallState("idle"); setCurrentDevice(null); currentDeviceRef.current = null; }, 1500); break;
      case "speech_message": { const speechMsg = msg as SpeechMessage; const incomingText = typeof speechMsg.text === "string" ? speechMsg.text : String(speechMsg.text ?? ""); const senderName = speechMsg.senderId === disc.getDeviceId() ? "You (loopback)" : "Remote device"; const chatMsg: ChatMessage = { id: speechMsg.id, senderId: speechMsg.senderId, senderName, text: incomingText, timestamp: speechMsg.timestamp }; setMessages(prev => prev.some(item => item.id === chatMsg.id) ? prev : [...prev, chatMsg]); void getTextToSpeechService().speak(incomingText); break; }
      case "call_end": setCallState("idle"); setCurrentDevice(null); currentDeviceRef.current = null; setIncomingCallFrom(null); setMessages([]); break;
      case "heartbeat": break;
    }
  }, []);

  useEffect(() => {
    let active = true; let localTcp: TCPService | null = null; let localDiscovery: DeviceDiscovery | null = null;
    const init = async () => {
      try {
        const disc = await getDeviceDiscovery(); if (!active) return; localDiscovery = disc; setDeviceId(disc.getDeviceId()); setDeviceName(disc.getDeviceName());
        const tcpService = new TCPService(disc.getDeviceId()); localTcp = tcpService; tcpRef.current = tcpService; setTcp(tcpService);
        disc.onDevicesChanged(newDevices => { if (!active) return; setDevices(newDevices); if (callStateRef.current !== "idle") return; const device = newDevices[0]; if (!device?.ip || tcpService.isConnected() || autoConnecting.current) return; autoConnecting.current = true; void tcpService.connectToDevice(device.ip, device.port || TCP_PORT).finally(() => { autoConnecting.current = false; }); });
        disc.onScanStatusChanged(status => { if (active) setScanStatus(status); });
        tcpService.onMessage(msg => { if (active) void handleIncomingMessage(msg, disc); });
        tcpService.onConnectionChange(connected => { if (active) setIsConnected(connected); if (!connected) autoConnecting.current = false; });
        await tcpService.startServer(); if (!active) { await tcpService.cleanup(); return; } setDiscovery(disc);
      } catch (error) { console.error("CommunicationProvider initialization failed", error); }
    };
    void init();
    return () => { active = false; autoConnecting.current = false; if (tcpRef.current === localTcp) tcpRef.current = null; void localTcp?.cleanup(); localDiscovery?.cleanup(); };
  }, [handleIncomingMessage]);

  useEffect(() => { if (!discovery || callState !== "idle" || refreshVersion === 0) return; discovery.stopDiscovery(); }, [discovery, refreshVersion, callState]);

  useEffect(() => {
    let active = true;
    const handleUrl = async (url: string | null) => {
      if (!active || !url || !url.startsWith("itantra://incoming-call")) return;
      const now = Date.now();
      const previousHandledAt = handledIncomingCallUrls.get(url);
      if (previousHandledAt && now - previousHandledAt < INCOMING_CALL_DEDUPE_MS) return;
      const parsed = Linking.parse(url); const ip = typeof parsed.queryParams?.ip === "string" ? parsed.queryParams.ip : ""; const name = typeof parsed.queryParams?.name === "string" ? parsed.queryParams.name : "iTantra device";
      if (!ip) return;
      const remote: Device = { id: `remote-${ip}`, name, ip, port: TCP_PORT, status: "connected", lastSeen: Date.now() };
      try {
        if (!active) return;
        autoConnecting.current = true;
        currentDeviceRef.current = remote;
        callStateRef.current = "calling";
        setCurrentDevice(remote);
        setIncomingCallFrom(null);
        setMessages([]);
        setCallState("calling");

        await new Promise(resolve => setTimeout(resolve, 300));
        if (!active) return;
        const reconnectService = tcpRef.current;
        if (!reconnectService) throw new Error("TCPService unavailable after notification handoff");
        await connectWithRetry(reconnectService, ip, TCP_PORT);
        if (!active) return;

        handledIncomingCallUrls.set(url, Date.now());
        setCallState("connected");
        callStateRef.current = "connected";
        router.replace("/communication");
      } catch (error) {
        if (!active) return;
        setCallState("disconnected");
        callStateRef.current = "disconnected";
        handledIncomingCallUrls.delete(url);
      } finally { autoConnecting.current = false; }
    };
    const initialUrlPromise = Linking.getInitialURL().then(handleUrl).catch(error => { if (active) console.error("getInitialURL failed", error); });
    const subscription = Linking.addEventListener("url", ({ url }) => { void handleUrl(url); });
    return () => { active = false; subscription.remove(); void initialUrlPromise; };
  }, [tcp]);

  const callDevice = useCallback(async (device: Device) => { if (!tcp || !device.ip) return; currentDeviceRef.current = device; setCurrentDevice(device); setCallState("calling"); setIncomingCallFrom(null); try { if (!tcp.isConnectedTo(device.ip, device.port || TCP_PORT)) await tcp.connectToDevice(device.ip, device.port || TCP_PORT); await tcp.sendMessage({ type: "call_request", senderId: deviceId, senderName: deviceName, timestamp: Date.now() }); } catch { await tcp.disconnect(); setCallState("idle"); setCurrentDevice(null); currentDeviceRef.current = null; } }, [tcp, deviceId, deviceName]);
  const cancelCall = useCallback(async () => { if (!tcp) return; try { if (tcp.isConnected()) await tcp.sendMessage({ type: "call_end", senderId: deviceId, timestamp: Date.now() }); } catch {} await tcp.disconnect(); setCallState("idle"); setCurrentDevice(null); currentDeviceRef.current = null; setIncomingCallFrom(null); }, [tcp, deviceId]);
  const acceptCall = useCallback(async () => { if (!tcp || !incomingCallFrom) return; try { await tcp.sendMessage({ type: "call_accept", senderId: deviceId, timestamp: Date.now() }); setCallState("connected"); setCurrentDevice(incomingCallFrom); currentDeviceRef.current = incomingCallFrom; setIncomingCallFrom(null); setMessages([]); } catch {} }, [tcp, incomingCallFrom, deviceId]);
  const rejectCall = useCallback(async () => { if (!tcp || !incomingCallFrom) return; try { await tcp.sendMessage({ type: "call_reject", senderId: deviceId, timestamp: Date.now() }); } catch {} await tcp.disconnect(); setCallState("idle"); setIncomingCallFrom(null); setCurrentDevice(null); currentDeviceRef.current = null; }, [tcp, incomingCallFrom, deviceId]);
  const endCall = useCallback(async () => { if (!tcp) return; try { if (tcp.isConnected()) await tcp.sendMessage({ type: "call_end", senderId: deviceId, timestamp: Date.now() }); } catch {} await tcp.disconnect(); setCallState("idle"); setCurrentDevice(null); currentDeviceRef.current = null; setIncomingCallFrom(null); setMessages([]); }, [tcp, deviceId]);
  const refreshDiscovery = useCallback(() => { setDevices([]); setRefreshVersion(value => value + 1); }, []);
  const sendMessage = useCallback(async (text: string) => { const trimmed = text.trim(); if (!tcp || !trimmed || !tcp.isConnected()) return; const msg: SpeechMessage = { type: "speech_message", id: generateUUID(), senderId: deviceId, text: trimmed, timestamp: Date.now() }; await tcp.sendMessage(msg); setMessages(prev => prev.some(item => item.id === msg.id) ? prev : [...prev, { id: msg.id, senderId: deviceId, senderName: deviceName || "You", text: trimmed, timestamp: msg.timestamp }]); }, [tcp, deviceId, deviceName]);
  const startSpeechRecognition = useCallback(async () => { const text = await getSpeechToTextService().listenForSpeech(); if (text?.trim()) await sendMessage(text); }, [sendMessage]);
  const stopSpeechRecognition = useCallback(async () => { await getSpeechToTextService().stopListening(); }, []);
  const cleanup = useCallback(async () => { await tcp?.cleanup(); discovery?.cleanup(); await getSpeechToTextService().cleanup(); await getTextToSpeechService().cleanup(); }, [tcp, discovery]);
  return <CommunicationContext.Provider value={{ devices, scanStatus, callState, messages, currentDevice, localDeviceId: deviceId, localDeviceName: deviceName, isConnected, incomingCallFrom, callDevice, cancelCall, acceptCall, rejectCall, endCall, refreshDiscovery, sendMessage, startSpeechRecognition, stopSpeechRecognition, cleanup }}>{children}</CommunicationContext.Provider>;
}

export function useCommunication() {
  const context = React.useContext(CommunicationContext);
  if (!context) throw new Error("useCommunication must be used within CommunicationProvider");
  return context;
}
