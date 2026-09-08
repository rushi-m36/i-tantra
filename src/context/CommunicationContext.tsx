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

const generateUUID = (): string => {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

interface CommunicationContextType {
  // State
    selfCall: () => Promise<void>;
  devices: Device[];
  callState: CallState;
  messages: ChatMessage[];
  currentDevice: Device | null;
  isConnected: boolean;
  incomingCallFrom: Device | null;

  // Actions
  startServer: () => Promise<void>;
  callDevice: (device: Device) => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => Promise<void>;
  endCall: () => Promise<void>;

    selfCall: () => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  startSpeechRecognition: () => Promise<void>;
  stopSpeechRecognition: () => Promise<void>;

  interface CommunicationContextType {
    // State
    devices: Device[];
    callState: CallState;
    messages: ChatMessage[];
    currentDevice: Device | null;
    isConnected: boolean;
    incomingCallFrom: Device | null;

    // Actions
    startServer: () => Promise<void>;
    callDevice: (device: Device) => Promise<void>;
    selfCall: () => Promise<void>;
    acceptCall: () => Promise<void>;
    rejectCall: () => Promise<void>;
    endCall: () => Promise<void>;
    sendMessage: (text: string) => Promise<void>;
    startSpeechRecognition: () => Promise<void>;
    stopSpeechRecognition: () => Promise<void>;

    // Cleanup
    cleanup: () => Promise<void>;

  // Cleanup
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
  const [deviceId, setDeviceId] = useState<string>("");
  const [deviceName, setDeviceName] = useState<string>("");

  // Initialize
  useEffect(() => {
    const init = async () => {
      const disc = await getDeviceDiscovery();
      setDiscovery(disc);
      setDeviceId(disc.getDeviceId());
      setDeviceName(disc.getDeviceName());

      const tcpService = new TCPService(disc.getDeviceId());
      setTcp(tcpService);

      // Listen for device changes
      disc.onDevicesChanged((newDevices) => {
        setDevices(newDevices);
      });

      // Listen for messages
      tcpService.onMessage((msg) => {
        handleIncomingMessage(msg, disc);
      });

      // Listen for connection changes
      tcpService.onConnectionChange((connected) => {
        setIsConnected(connected);
      });

      // Start discovery and server
      disc.startDiscovery();
      await tcpService.startServer();
    };

    init();

    return () => {
      if (discovery) discovery.cleanup();
      if (tcp) tcp.cleanup();
    };
  }, []);

  const handleIncomingMessage = (msg: Message, disc: DeviceDiscovery) => {
    switch (msg.type) {
      case "call_request":
        const callReq = msg as CallRequestMessage;
        const caller: Device = {
          id: callReq.senderId,
          name: callReq.senderName,
          ip: "",
          port: 5555,
          status: "calling",
          lastSeen: Date.now(),
        };
        setIncomingCallFrom(caller);
        setCallState("incoming");
        break;

      case "call_accept":
        setCallState("connected");
        setMessages([]);
        break;

      case "call_reject":
        setCallState("rejected");
        setTimeout(() => {
          setCallState("idle");
          setCurrentDevice(null);
        }, 2000);
        break;

      case "speech_message":
        const speechMsg = msg as SpeechMessage;
        const newMsg: ChatMessage = {
          id: speechMsg.id,
          senderId: speechMsg.senderId,
          senderName:
            currentDevice?.name ||
            devices.find((d) => d.id === speechMsg.senderId)?.name ||
            "Caller",
          text: speechMsg.text,
          timestamp: speechMsg.timestamp,
        };
        setMessages((prev) => [...prev, newMsg]);
        // Auto-play received message
        getTextToSpeechService().speak(speechMsg.text);
        break;

      case "call_end":
        setCallState("idle");
        setCurrentDevice(null);
        setIncomingCallFrom(null);
        setMessages([]);
        break;
    }
  };

  const startServer = useCallback(async () => {
    if (!tcp || !discovery) return;
    await tcp.startServer();
  }, [tcp, discovery]);

  const callDevice = useCallback(
    async (device: Device) => {
      if (!tcp || !discovery) return;

      setCurrentDevice(device);
      setCallState("calling");

      try {
        // Connect to device
        await tcp.connectToDevice(device.ip, device.port);

        // Send call request
        const msg: CallRequestMessage = {
          type: "call_request",
          senderId: deviceId,
          senderName: deviceName,
          timestamp: Date.now(),
        };

        await tcp.sendMessage(msg);
      } catch (e) {
        console.error("Failed to call device:", e);
        setCallState("idle");
        setCurrentDevice(null);
      }
    },
    [tcp, discovery, deviceId, deviceName],
  );

  const acceptCall = useCallback(async () => {
    const selfCall = useCallback(
      async () => {
        if (!tcp || !discovery) return;

        const selfDevice: Device = {
          id: deviceId,
          name: `${deviceName} (Self)`,
          ip: "127.0.0.1",
          port: 5555,
          status: "available",
          lastSeen: Date.now(),
        };

        setCurrentDevice(selfDevice);
        setCallState("calling");

        try {
          // Connect to localhost
          await tcp.connectToDevice("127.0.0.1", 5555);

          // Auto-accept after short delay (simulate local call)
          setTimeout(() => {
            setCallState("connected");
            setMessages([]);
          }, 1000);
        } catch (e) {
          console.error("Failed to self-call:", e);
          setCallState("idle");
          setCurrentDevice(null);
        }
      },
      [tcp, discovery, deviceId, deviceName],
    );

    const acceptCall = useCallback(async () => {
    if (!tcp || !incomingCallFrom) return;

    setCallState("connected");
    setCurrentDevice(incomingCallFrom);

    try {
      const msg: CallAcceptMessage = {
        type: "call_accept",
        senderId: deviceId,
        timestamp: Date.now(),
      };

      await tcp.sendMessage(msg);
    } catch (e) {
      console.error("Failed to accept call:", e);
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
    } catch (e) {
      console.error("Failed to reject call:", e);
    }

    setCallState("idle");
    setIncomingCallFrom(null);
    await tcp.disconnect();
  }, [tcp, incomingCallFrom, deviceId]);

  const endCall = useCallback(async () => {
    if (!tcp) return;

    try {
      const msg: Message = {
        type: "call_end",
        senderId: deviceId,
        timestamp: Date.now(),
      };

      await tcp.sendMessage(msg);
    } catch (e) {
      console.error("Failed to end call:", e);
    }

    await tcp.disconnect();
    setCallState("idle");
    setCurrentDevice(null);
    setIncomingCallFrom(null);
    setMessages([]);
  }, [tcp, deviceId]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!tcp) return;

      const msg: SpeechMessage = {
        type: "speech_message",
        id: generateUUID(),
        senderId: deviceId,
        text,
        timestamp: Date.now(),
      };

      await tcp.sendMessage(msg);

      // Add to local messages
      const chatMsg: ChatMessage = {
        id: msg.id,
        senderId: deviceId,
        senderName: deviceName,
        text,
        timestamp: msg.timestamp,
      };

      setMessages((prev) => [...prev, chatMsg]);
    },
    [tcp, deviceId, deviceName],
  );

  const startSpeechRecognition = useCallback(async () => {
    const stt = getSpeechToTextService();
    try {
      const text = await stt.listenForSpeech();
      if (text) {
        await sendMessage(text);
      }
    } catch (e) {
      console.error("Speech recognition failed:", e);
    }
  }, [sendMessage]);

  const stopSpeechRecognition = useCallback(async () => {
    const stt = getSpeechToTextService();
    await stt.stopListening();
  }, []);

  const cleanup = useCallback(async () => {
    if (tcp) await tcp.cleanup();
    if (discovery) discovery.cleanup();
    getSpeechToTextService().cleanup();
    getTextToSpeechService().cleanup();
  }, [tcp, discovery]);

  return (
    <CommunicationContext.Provider
      value={{
        devices,
        callState,
        messages,
        currentDevice,
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
