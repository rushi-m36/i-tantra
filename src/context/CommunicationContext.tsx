import React, { createContext, useCallback, useEffect, useRef, useState } from "react";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import { DeviceDiscovery, getDeviceDiscovery, ScanStatus } from "../services/network/deviceDiscovery";
import { TCPService } from "../services/network/tcpService";
import { getSpeechToTextService } from "../services/speech/speechToText";
import { getTextToSpeechService } from "../services/speech/textToSpeech";
import { CallRequestMessage, CallState, ChatMessage, Device, Message, SpeechMessage } from "../types/communication";

const TCP_PORT = 5555;
const generateUUID = (): string => "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; const v = c === "x" ? r : (r & 0x3) | 0x8; return v.toString(16); });

interface CommunicationContextType {
  devices: Device[]; scanStatus: ScanStatus; callState: CallState; messages: ChatMessage[]; currentDevice: Device | null; localDeviceId: string; localDeviceName: string; isConnected: boolean; incomingCallFrom: Device | null;
  callDevice: (device: Device) => Promise<void>; cancelCall: () => Promise<void>; acceptCall: () => Promise<void>; rejectCall: () => Promise<void>; endCall: () => Promise<void>; refreshDiscovery: () => void; sendMessage: (text: string) => Promise<void>; startSpeechRecognition: () => Promise<void>; stopSpeechRecognition: () => Promise<void>; cleanup: () => Promise<void>;
}
export const CommunicationContext = createContext<CommunicationContextType | undefined>(undefined);

export function CommunicationProvider({ children }: { children: React.ReactNode }) {
  const [devices, setDevices] = useState<Device[]>([]); const [scanStatus, setScanStatus] = useState<ScanStatus>({ scanning: false, currentIp: null, scanned: 0, total: 0, found: 0, phase: "idle" }); const [callState, setCallState] = useState<CallState>("idle"); const [messages, setMessages] = useState<ChatMessage[]>([]); const [currentDevice, setCurrentDevice] = useState<Device | null>(null); const currentDeviceRef = useRef<Device | null>(null); const callStateRef = useRef<CallState>("idle"); const [isConnected, setIsConnected] = useState(false); const [incomingCallFrom, setIncomingCallFrom] = useState<Device | null>(null); const [tcp, setTcp] = useState<TCPService | null>(null); const tcpRef = useRef<TCPService | null>(null); const [discovery, setDiscovery] = useState<DeviceDiscovery | null>(null); const [deviceId, setDeviceId] = useState(""); const [deviceName, setDeviceName] = useState(""); const [refreshVersion, setRefreshVersion] = useState(0); const autoConnecting = useRef(false);
  useEffect(() => { currentDeviceRef.current = currentDevice; }, [currentDevice]);
  useEffect(() => { callStateRef.current = callState; }, [callState]);

  const handleIncomingMessage = useCallback(async (msg: Message, disc: DeviceDiscovery) => {
    console.log(`[CALL FLOW 10] RN received TCP message type=${msg.type}`);
    switch (msg.type) {
      case "call_request": { const callReq = msg as CallRequestMessage; console.log(`[CALL FLOW 11] call_request sender=${callReq.senderName} id=${callReq.senderId}`); const caller: Device = { id: callReq.senderId, name: callReq.senderName, ip: "", port: TCP_PORT, status: "calling", lastSeen: Date.now() }; currentDeviceRef.current = caller; setIncomingCallFrom(caller); setCurrentDevice(caller); setCallState("incoming"); console.log("[CALL FLOW 12] RN call state=incoming"); break; }
      case "call_accept": { console.log("[CALL FLOW 20] call_accept received by caller-side RN"); setCallState("connected"); setIncomingCallFrom(null); setMessages([]); const peer = currentDeviceRef.current; const service = tcpRef.current; console.log(`[CALL FLOW 21] caller peer=${JSON.stringify(peer)} tcp=${!!service}`); if (peer?.ip && service) { try { await new Promise((resolve) => setTimeout(resolve, 500)); console.log(`[CALL FLOW 22] caller reconnecting to ${peer.ip}:${peer.port || TCP_PORT}`); await service.connectToDevice(peer.ip, peer.port || TCP_PORT); console.log("[CALL FLOW 23] caller reconnect SUCCESS"); } catch (error) { console.error("[CALL FLOW 24] caller reconnect FAILED", error); } } else console.warn("[CALL FLOW 25] caller cannot reconnect: peer IP or TCPService missing"); break; }
      case "call_reject": setCallState("rejected"); setIncomingCallFrom(null); setTimeout(() => { setCallState("idle"); setCurrentDevice(null); currentDeviceRef.current = null; }, 1500); break;
      case "speech_message": { const speechMsg = msg as SpeechMessage; const incomingText = typeof speechMsg.text === "string" ? speechMsg.text : String(speechMsg.text ?? ""); const senderName = speechMsg.senderId === disc.getDeviceId() ? "You (loopback)" : "Remote device"; const chatMsg: ChatMessage = { id: speechMsg.id, senderId: speechMsg.senderId, senderName, text: incomingText, timestamp: speechMsg.timestamp }; setMessages((prev) => prev.some((item) => item.id === chatMsg.id) ? prev : [...prev, chatMsg]); void getTextToSpeechService().speak(incomingText); break; }
      case "call_end": setCallState("idle"); setCurrentDevice(null); currentDeviceRef.current = null; setIncomingCallFrom(null); setMessages([]); break;
      case "heartbeat": break;
    }
  }, []);

  useEffect(() => {
    let active = true; let localTcp: TCPService | null = null; let localDiscovery: DeviceDiscovery | null = null;
    const init = async () => {
      console.log("[CALL FLOW 01] CommunicationProvider init START");
      try {
        const disc = await getDeviceDiscovery(); if (!active) return; localDiscovery = disc; setDeviceId(disc.getDeviceId()); setDeviceName(disc.getDeviceName()); console.log(`[CALL FLOW 02] discovery ready id=${disc.getDeviceId()} name=${disc.getDeviceName()}`);
        const tcpService = new TCPService(disc.getDeviceId()); localTcp = tcpService; tcpRef.current = tcpService; setTcp(tcpService); console.log("[CALL FLOW 03] TCPService created");
        disc.onDevicesChanged((newDevices) => { if (!active) return; setDevices(newDevices); console.log(`[CALL FLOW 04] devices changed count=${newDevices.length}`); if (callStateRef.current !== "idle") { console.log(`[CALL FLOW 05] auto-connect skipped callState=${callStateRef.current}`); return; } const device = newDevices[0]; if (!device?.ip || tcpService.isConnected() || autoConnecting.current) return; autoConnecting.current = true; console.log(`[CALL FLOW 06] auto-connect START ${device.ip}:${device.port || TCP_PORT}`); void tcpService.connectToDevice(device.ip, device.port || TCP_PORT).then(() => console.log("[CALL FLOW 07] auto-connect SUCCESS")).catch((e) => console.error("[CALL FLOW 07] auto-connect FAILED", e)).finally(() => { autoConnecting.current = false; }); });
        disc.onScanStatusChanged((status) => { if (active) setScanStatus(status); }); tcpService.onMessage((msg) => { console.log(`[CALL FLOW 08] TCP callback message=${msg.type}`); if (active) void handleIncomingMessage(msg, disc); }); tcpService.onConnectionChange((connected) => { console.log(`[CALL FLOW 09] TCP connection=${connected}`); if (active) setIsConnected(connected); if (!connected) autoConnecting.current = false; });
        console.log("[CALL FLOW 09A] starting foreground TCP server"); await tcpService.startServer(); console.log("[CALL FLOW 09B] foreground TCP server STARTED"); if (!active) { await tcpService.cleanup(); return; } setDiscovery(disc); console.log("[CALL FLOW 09C] CommunicationProvider init COMPLETE");
      } catch (error) { console.error("[CALL FLOW ERROR] CommunicationProvider init FAILED", error); }
    }; void init(); return () => { console.log("[CALL FLOW CLEANUP] CommunicationProvider cleanup"); active = false; autoConnecting.current = false; if (tcpRef.current === localTcp) tcpRef.current = null; void localTcp?.cleanup(); localDiscovery?.cleanup(); };
  }, [handleIncomingMessage]);

  useEffect(() => { if (!discovery || callState !== "idle" || refreshVersion === 0) return; discovery.stopDiscovery(); }, [discovery, refreshVersion, callState]);

  useEffect(() => {
    if (!tcp) return; let handledUrl = "";
    const handleUrl = async (url: string | null) => {
      console.log(`[CALL FLOW 30] handleUrl invoked url=${url}`);
      if (!url || !url.startsWith("itantra://incoming-call") || url === handledUrl) { console.log("[CALL FLOW 31] URL ignored"); return; }
      handledUrl = url; console.log(`[CALL FLOW 32] DEEP LINK ACCEPTED ${url}`);
      const parsed = Linking.parse(url); const ip = typeof parsed.queryParams?.ip === "string" ? parsed.queryParams.ip : ""; const name = typeof parsed.queryParams?.name === "string" ? parsed.queryParams.name : "iTantra device"; console.log(`[CALL FLOW 33] parsed ip=${ip} name=${name}`); if (!ip) { console.error("[CALL FLOW 34] ABORT: no IP"); return; }
      const remote: Device = { id: `remote-${ip}`, name, ip, port: TCP_PORT, status: "connected", lastSeen: Date.now() };
      try { autoConnecting.current = true; currentDeviceRef.current = remote; setCurrentDevice(remote); setIncomingCallFrom(null); setMessages([]); setCallState("calling"); console.log("[CALL FLOW 35] state=calling; navigating /communication"); router.replace("/communication"); console.log("[CALL FLOW 36] router.replace returned"); await new Promise((resolve) => setTimeout(resolve, 700)); console.log(`[CALL FLOW 37] callee reconnect START ${ip}:${TCP_PORT}`); await tcp.connectToDevice(ip, TCP_PORT); console.log("[CALL FLOW 38] callee reconnect SUCCESS"); setCallState("connected"); console.log("[CALL FLOW 39] state=connected"); }
      catch (error) { console.error("[CALL FLOW 40] callee handoff/reconnect FAILED", error); setCallState("idle"); setCurrentDevice(null); currentDeviceRef.current = null; }
      finally { autoConnecting.current = false; console.log("[CALL FLOW 41] deep-link handler FINISHED"); }
    };
    console.log("[CALL FLOW 29] Registering Expo Linking handlers"); void Linking.getInitialURL().then((url) => { console.log(`[CALL FLOW 29A] getInitialURL=${url}`); return handleUrl(url); }); const subscription = Linking.addEventListener("url", ({ url }) => { console.log(`[CALL FLOW 29B] URL event=${url}`); void handleUrl(url); }); return () => { console.log("[CALL FLOW CLEANUP] Removing Linking listener"); subscription.remove(); };
  }, [tcp]);

  const callDevice = useCallback(async (device: Device) => { if (!tcp || !device.ip) return; console.log(`[CALL FLOW OUTGOING] callDevice ${device.ip}:${device.port || TCP_PORT}`); currentDeviceRef.current = device; setCurrentDevice(device); setCallState("calling"); setIncomingCallFrom(null); try { if (!tcp.isConnectedTo(device.ip, device.port || TCP_PORT)) await tcp.connectToDevice(device.ip, device.port || TCP_PORT); await tcp.sendMessage({ type: "call_request", senderId: deviceId, senderName: deviceName, timestamp: Date.now() }); console.log("[CALL FLOW OUTGOING] call_request SENT"); } catch (error) { console.error("[CALL FLOW OUTGOING] FAILED", error); await tcp.disconnect(); setCallState("idle"); setCurrentDevice(null); currentDeviceRef.current = null; } }, [tcp, deviceId, deviceName]);
  const cancelCall = useCallback(async () => { if (!tcp) return; console.log("[CALL FLOW] cancelCall"); try { if (tcp.isConnected()) await tcp.sendMessage({ type: "call_end", senderId: deviceId, timestamp: Date.now() }); } catch {} await tcp.disconnect(); setCallState("idle"); setCurrentDevice(null); currentDeviceRef.current = null; setIncomingCallFrom(null); }, [tcp, deviceId]);
  const acceptCall = useCallback(async () => { if (!tcp || !incomingCallFrom) return; console.log("[CALL FLOW INCOMING] foreground acceptCall() invoked"); try { await tcp.sendMessage({ type: "call_accept", senderId: deviceId, timestamp: Date.now() }); console.log("[CALL FLOW INCOMING] call_accept SENT"); setCallState("connected"); setCurrentDevice(incomingCallFrom); currentDeviceRef.current = incomingCallFrom; setIncomingCallFrom(null); setMessages([]); } catch (error) { console.error("[CALL FLOW INCOMING] acceptCall FAILED", error); } }, [tcp, incomingCallFrom, deviceId]);
  const rejectCall = useCallback(async () => { if (!tcp || !incomingCallFrom) return; console.log("[CALL FLOW INCOMING] rejectCall() invoked"); try { await tcp.sendMessage({ type: "call_reject", senderId: deviceId, timestamp: Date.now() }); } catch {} await tcp.disconnect(); setCallState("idle"); setIncomingCallFrom(null); setCurrentDevice(null); currentDeviceRef.current = null; }, [tcp, incomingCallFrom, deviceId]);
  const endCall = useCallback(async () => { if (!tcp) return; console.log("[CALL FLOW] endCall() invoked"); try { if (tcp.isConnected()) await tcp.sendMessage({ type: "call_end", senderId: deviceId, timestamp: Date.now() }); } catch {} await tcp.disconnect(); setCallState("idle"); setCurrentDevice(null); currentDeviceRef.current = null; setIncomingCallFrom(null); setMessages([]); }, [tcp, deviceId]);
  const refreshDiscovery = useCallback(() => { console.log("[CALL FLOW] refreshDiscovery() invoked"); setDevices([]); setRefreshVersion((value) => value + 1); }, []);
  const sendMessage = useCallback(async (text: string) => { const trimmed = text.trim(); if (!tcp || !trimmed || !tcp.isConnected()) return; const msg: SpeechMessage = { type: "speech_message", id: generateUUID(), senderId: deviceId, text: trimmed, timestamp: Date.now() }; console.log(`[CALL FLOW MESSAGE] sending ${JSON.stringify(trimmed)}`); await tcp.sendMessage(msg); setMessages((prev) => prev.some((item) => item.id === msg.id) ? prev : [...prev, { id: msg.id, senderId: deviceId, senderName: deviceName || "You", text: trimmed, timestamp: msg.timestamp }]); }, [tcp, deviceId, deviceName]);
  const startSpeechRecognition = useCallback(async () => { const text = await getSpeechToTextService().listenForSpeech(); if (text?.trim()) await sendMessage(text); }, [sendMessage]); const stopSpeechRecognition = useCallback(async () => { await getSpeechToTextService().stopListening(); }, []); const cleanup = useCallback(async () => { console.log("[CALL FLOW] cleanup() invoked"); await tcp?.cleanup(); discovery?.cleanup(); await getSpeechToTextService().cleanup(); await getTextToSpeechService().cleanup(); }, [tcp, discovery]);
  return <CommunicationContext.Provider value={{ devices, scanStatus, callState, messages, currentDevice, localDeviceId: deviceId, localDeviceName: deviceName, isConnected, incomingCallFrom, callDevice, cancelCall, acceptCall, rejectCall, endCall, refreshDiscovery, sendMessage, startSpeechRecognition, stopSpeechRecognition, cleanup }}>{children}</CommunicationContext.Provider>;
}
export function useCommunication() { const context = React.useContext(CommunicationContext); if (!context) throw new Error("useCommunication must be used within CommunicationProvider"); return context; }
