// Message types for iTantra communication protocol
export type MessageType =
  | "call_request"
  | "call_accept"
  | "call_reject"
  | "speech_message"
  | "call_end"
  | "heartbeat";

export interface CallRequestMessage {
  type: "call_request";
  senderId: string;
  senderName: string;
  timestamp: number;
}

export interface CallAcceptMessage {
  type: "call_accept";
  senderId: string;
  timestamp: number;
}

export interface CallRejectMessage {
  type: "call_reject";
  senderId: string;
  timestamp: number;
}

export interface SpeechMessage {
  type: "speech_message";
  id: string;
  senderId: string;
  text: string;
  timestamp: number;
}

export interface CallEndMessage {
  type: "call_end";
  senderId: string;
  timestamp: number;
}

export interface HeartbeatMessage {
  type: "heartbeat";
  senderId: string;
  timestamp: number;
}

export type Message =
  | CallRequestMessage
  | CallAcceptMessage
  | CallRejectMessage
  | SpeechMessage
  | CallEndMessage
  | HeartbeatMessage;

export interface Device {
  id: string;
  name: string;
  ip: string;
  port: number;
  status: "available" | "connected" | "calling" | "offline";
  lastSeen: number;
}

export type CallState =
  "idle" | "calling" | "incoming" | "connected" | "rejected" | "disconnected";

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
}
