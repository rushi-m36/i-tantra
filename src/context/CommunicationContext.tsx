import React, { createContext, useCallback, useEffect, useState } from "react";
import {
  DeviceDiscovery,
  getDeviceDiscovery,
} from "../services/network/deviceDiscovery";
import { TCPService } from "../services/network/tcpService";
import { getSpeechToTextService } from "../services/speech/speechToText";
import { getTextToSpeechService } from "../services/speech/textToSpeech";
import {
  CallAcceptMessage,
  CallRejectMessage,
  CallRequestMessage,
  CallState,
  ChatMessage,
  Device,
  Message,
  SpeechMessage,
} from "../types/communication";

const TCP_PORT = 5555;

const generateUUID = (): string =>
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });

interface CommunicationContextType {
  devices: Device[];
  callState: CallState;
  messages: ChatMessage[];
  currentDevice: Device | null;
  localDeviceId: string;
  localDeviceName: string;
  isConnected: boolean;
  incomingCallFrom: Device | null;

  startServer: () => Promise<void>;
  callDevice: (device: Device) => Promise<void>;
  selfCall: () => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => Promise<void>;
  endCall: () => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  startSpeechRecognition: () => Promise<void>;
  stopSpeechRecognition: () => Promise<void>;
  cleanup: () => Promise<void>;
}

export const CommunicationContext = createContext<
  CommunicationContextType | undefined
>(undefined);

export function CommunicationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [callState, setCallState] = useState<CallState>("idle");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentDevice, setCurrentDevice] = useState<Device | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [incomingCallFrom, setIncomingCallFrom] = useState<Device | null>(null);
  const [tcp, setTcp] = useState<TCPService | null>(null);
  const [discovery, setDiscovery] = useState<DeviceDiscovery | null>(null);
  const [deviceId, setDeviceId] = useState("");
  const [deviceName, setDeviceName] = useState("");

  const handleIncomingMessage = useCallback(
    (msg: Message, disc: DeviceDiscovery) => {
      switch (msg.type) {
        case "call_request": {
          const callReq = msg as CallRequestMessage;
          const caller: Device = {
            id: callReq.senderId,
            name: callReq.senderName,
            ip: "",
            port: TCP_PORT,
            status: "calling",
            lastSeen: Date.now(),
          };

          setIncomingCallFrom(caller);
          setCurrentDevice(caller);
          setCallState("incoming");
          break;
        }

        case "call_accept":
          setCallState("connected");
          setIncomingCallFrom(null);
          setMessages([]);
          break;

        case "call_reject":
          setCallState("rejected");
          setIncomingCallFrom(null);
          setTimeout(() => {
            setCallState("idle");
            setCurrentDevice(null);
          }, 1500);
          break;

        case "speech_message": {
          const speechMsg = msg as SpeechMessage;
          const sender =
            devices.find((d) => d.id === speechMsg.senderId)?.name ||
            currentDevice?.name ||
            "Device";

          const chatMsg: ChatMessage = {
            id: speechMsg.id,
            senderId: speechMsg.senderId,
            senderName: sender,
            text: speechMsg.text,
            timestamp: speechMsg.timestamp,
          };

          setMessages((prev) => [...prev, chatMsg]);
          void getTextToSpeechService().speak(speechMsg.text);
          break;
        }

        case "call_end":
          setCallState("idle");
          setCurrentDevice(null);
          setIncomingCallFrom(null);
          setMessages([]);
          break;

        case "heartbeat":
          break;
      }
    },
    [currentDevice, devices],
  );

  useEffect(() => {
    let active = true;
    let localTcp: TCPService | null = null;
    let localDiscovery: DeviceDiscovery | null = null;

    const init = async () => {
      try {
        const disc = await getDeviceDiscovery();
        if (!active) return;

        localDiscovery = disc;
        setDiscovery(disc);
        setDeviceId(disc.getDeviceId());
        setDeviceName(disc.getDeviceName());

        const tcpService = new TCPService(disc.getDeviceId());
        localTcp = tcpService;
        setTcp(tcpService);

        disc.onDevicesChanged((newDevices) => {
          if (active) setDevices(newDevices);
        });

        tcpService.onMessage((msg) => {
          if (active) handleIncomingMessage(msg, disc);
        });

        tcpService.onConnectionChange((connected) => {
          if (active) setIsConnected(connected);
        });

        disc.startDiscovery();
        await tcpService.startServer();
      } catch (error) {
        console.error("Failed to initialize communication services:", error);
      }
    };

    void init();

    return () => {
      active = false;
      void localTcp?.cleanup();
      localDiscovery?.cleanup();
    };
  }, [handleIncomingMessage]);

  const startServer = useCallback(async () => {
    if (!tcp) return;
    await tcp.startServer();
  }, [tcp]);

  const callDevice = useCallback(
    async (device: Device) => {
      if (!tcp || !device.ip) return;

      setCurrentDevice(device);
      setCallState("calling");
      setIncomingCallFrom(null);

      try {
        await tcp.connectToDevice(device.ip, device.port || TCP_PORT);

        const msg: CallRequestMessage = {
          type: "call_request",
          senderId: deviceId,
          senderName: deviceName,
          timestamp: Date.now(),
        };

        await tcp.sendMessage(msg);
      } catch (error) {
        console.error("Failed to call device:", error);
        await tcp.disconnect();
        setCallState("idle");
        setCurrentDevice(null);
      }
    },
    [tcp, deviceId, deviceName],
  );

  /**
   * Single-phone loopback test.
   * Uses the real TCP server on localhost, then runs the normal call handshake.
   */
  const selfCall = useCallback(async () => {
    if (!tcp || !deviceId) return;

    const selfDevice: Device = {
      id: deviceId,
      name: `${deviceName || "This device"} (Self Test)`,
      ip: "127.0.0.1",
      port: TCP_PORT,
      status: "connected",
      lastSeen: Date.now(),
    };

    setCurrentDevice(selfDevice);
    setMessages([]);
    setCallState("calling");
    setIncomingCallFrom(null);

    try {
      await tcp.startServer();
      await tcp.connectToDevice("127.0.0.1", TCP_PORT);

      const request: CallRequestMessage = {
        type: "call_request",
        senderId: deviceId,
        senderName: deviceName || "This device",
        timestamp: Date.now(),
      };

      await tcp.sendMessage(request);

      // Let the normal incoming-call handler receive the loopback request,
      // then automatically accept it so the complete call flow is exercised.
      setTimeout(async () => {
        setCallState((state) => {
          if (state === "incoming") return state;
          return state;
        });

        const accept: CallAcceptMessage = {
          type: "call_accept",
          senderId: deviceId,
          timestamp: Date.now(),
        };

        try {
          await tcp.sendMessage(accept);
          setCallState("connected");
          setIncomingCallFrom(null);
        } catch (error) {
          console.error("Self-call accept failed:", error);
          await tcp.disconnect();
          setCallState("idle");
          setCurrentDevice(null);
        }
      }, 300);
    } catch (error) {
      console.error("Failed to self-call:", error);
      await tcp.disconnect();
      setCallState("idle");
      setCurrentDevice(null);
    }
  }, [tcp, deviceId, deviceName]);

  const acceptCall = useCallback(async () => {
    if (!tcp || !incomingCallFrom) return;

    try {
      const msg: CallAcceptMessage = {
        type: "call_accept",
        senderId: deviceId,
        timestamp: Date.now(),
      };

      await tcp.sendMessage(msg);
      setCallState("connected");
      setCurrentDevice(incomingCallFrom);
      setIncomingCallFrom(null);
      setMessages([]);
    } catch (error) {
      console.error("Failed to accept call:", error);
    }
  }, [tcp, incomingCallFrom, deviceId]);

  const rejectCall = useCallback(async () => {
    if (!tcp || !incomingCallFrom) return;

    try {
      const msg: CallRejectMessage = {
        type: "call_reject",
        senderId: deviceId,
        timestamp: Date.now(),
      };
      await tcp.sendMessage(msg);
    } catch (error) {
      console.error("Failed to reject call:", error);
    }

    await tcp.disconnect();
    setCallState("idle");
    setIncomingCallFrom(null);
    setCurrentDevice(null);
  }, [tcp, incomingCallFrom, deviceId]);

  const endCall = useCallback(async () => {
    if (!tcp) return;

    try {
      if (tcp.isConnected()) {
        const msg: Message = {
          type: "call_end",
          senderId: deviceId,
          timestamp: Date.now(),
        };
        await tcp.sendMessage(msg);
      }
    } catch (error) {
      console.error("Failed to send call_end:", error);
    }

    await tcp.disconnect();
    setCallState("idle");
    setCurrentDevice(null);
    setIncomingCallFrom(null);
    setMessages([]);
  }, [tcp, deviceId]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!tcp || !trimmed || !tcp.isConnected()) return;

      const msg: SpeechMessage = {
        type: "speech_message",
        id: generateUUID(),
        senderId: deviceId,
        text: trimmed,
        timestamp: Date.now(),
      };

      await tcp.sendMessage(msg);

      setMessages((prev) => [
        ...prev,
        {
          id: msg.id,
          senderId: deviceId,
          senderName: deviceName || "You",
          text: trimmed,
          timestamp: msg.timestamp,
        },
      ]);
    },
    [tcp, deviceId, deviceName],
  );

  const startSpeechRecognition = useCallback(async () => {
    const stt = getSpeechToTextService();
    const text = await stt.listenForSpeech();
    if (text?.trim()) {
      await sendMessage(text);
    }
  }, [sendMessage]);

  const stopSpeechRecognition = useCallback(async () => {
    await getSpeechToTextService().stopListening();
  }, []);

  const cleanup = useCallback(async () => {
    await tcp?.cleanup();
    discovery?.cleanup();
    await getSpeechToTextService().cleanup();
    await getTextToSpeechService().cleanup();
  }, [tcp, discovery]);

  return (
    <CommunicationContext.Provider
      value={{
        devices,
        callState,
        messages,
        currentDevice,
        localDeviceId: deviceId,
        localDeviceName: deviceName,
        isConnected,
        incomingCallFrom,
        startServer,
        callDevice,
        selfCall,
        acceptCall,
        rejectCall,
        endCall,
        sendMessage,
        startSpeechRecognition,
        stopSpeechRecognition,
        cleanup,
      }}
    >
      {children}
    </CommunicationContext.Provider>
  );
}

export function useCommunication() {
  const context = React.useContext(CommunicationContext);
  if (!context) {
    throw new Error(
      "useCommunication must be used within CommunicationProvider",
    );
  }
  return context;
}
