import TcpSocket from "react-native-tcp-socket";
import { Message } from "../../types/communication";
import { MessageProtocol } from "./messageProtocol";

const SERVER_PORT = 5555;
const TCP_TIMEOUT = 10000;
const HEARTBEAT_INTERVAL = 5000;

/** Convert react-native-tcp-socket data into UTF-8 text without relying on Node's Buffer global. */
const decodeTcpData = (data: any): string => {
  if (typeof data === "string") return data;
  if (data && typeof data.toString === "function") {
    const decoded = data.toString("utf8");
    if (typeof decoded === "string") return decoded;
  }
  if (data instanceof Uint8Array) return new TextDecoder("utf-8").decode(data);
  throw new Error("Unsupported TCP data type");
};

export class TCPService {
  private serverId: string;
  private serverSocket: any = null;
  private clientSocket: any = null;
  private messageProtocol = new MessageProtocol();
  private messageCallbacks: Array<(msg: Message) => void> = [];
  private connectionCallbacks: Array<(connected: boolean) => void> = [];
  private server: any = null;
  private startPromise: Promise<number> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(serverId: string) {
    this.serverId = serverId;
  }

  private getActiveSocket(): any | null {
    const socket = this.clientSocket || this.serverSocket;
    return socket && !socket.destroyed ? socket : null;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      const socket = this.getActiveSocket();
      if (!socket) {
        this.stopHeartbeat();
        return;
      }
      try {
        socket.write(MessageProtocol.encode({
          type: "heartbeat",
          senderId: this.serverId,
          timestamp: Date.now(),
        } as Message));
      } catch (error) {
        console.error("TCP heartbeat failed:", error);
      }
    }, HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /** Start the TCP server. Safe to call more than once. */
  async startServer(): Promise<number> {
    if (this.server?.listening) return SERVER_PORT;
    const existingStartPromise = this.startPromise;
    if (existingStartPromise) return existingStartPromise;

    const startPromise: Promise<number> = new Promise<number>((resolve, reject) => {
      let settled = false;
      let server: any = null;
      const cleanupStartPromise = () => {
        if (this.startPromise === startPromise) this.startPromise = null;
      };

      try {
        server = TcpSocket.createServer((socket: any) => {
          console.log("TCP client connected:", socket.address());
          this.serverSocket = socket;
          if (typeof socket.setTimeout === "function") socket.setTimeout(0);
          this.startHeartbeat();
          this.connectionCallbacks.forEach((cb) => cb(true));

          socket.on("data", (data: any) => {
            try {
              const dataStr = decodeTcpData(data);
              const { messages } = this.messageProtocol.processData(dataStr);
              messages.forEach((msg) => this.messageCallbacks.forEach((cb) => cb(msg)));
            } catch (error) {
              console.error("Failed to process TCP data:", error);
            }
          });
          socket.on("error", (err: any) => console.error("TCP server socket error:", err));
          socket.on("close", () => {
            console.log("TCP client disconnected");
            if (this.serverSocket === socket) this.serverSocket = null;
            if (!this.clientSocket) {
              this.stopHeartbeat();
              this.connectionCallbacks.forEach((cb) => cb(false));
            }
          });
        });
        this.server = server;
        server.on("error", (err: any) => {
          console.error("TCP server error:", err);
          if (!settled) {
            settled = true;
            this.server = null;
            cleanupStartPromise();
            if (err?.code === "EADDRINUSE") {
              reject(new Error(`TCP port ${SERVER_PORT} is already in use. The previous app instance may still be running. Stop/restart the development build and try again.`));
            } else reject(err);
          }
        });
        server.on("close", () => {
          if (this.server === server) this.server = null;
        });
        server.listen({ port: SERVER_PORT, host: "0.0.0.0", reuseAddress: true }, () => {
          if (!settled) {
            settled = true;
            cleanupStartPromise();
            console.log("TCP server listening on port", SERVER_PORT);
            resolve(SERVER_PORT);
          }
        });
      } catch (error) {
        if (!settled) {
          settled = true;
          this.server = null;
          cleanupStartPromise();
          reject(error);
        }
      }
    });
    this.startPromise = startPromise;
    return startPromise;
  }

  /** Connect to a remote TCP server. */
  async connectToDevice(ip: string, port: number = SERVER_PORT): Promise<void> {
    if (this.clientSocket) {
      this.clientSocket.destroy();
      this.clientSocket = null;
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      try {
        const options: any = { host: ip, port, reuseAddress: true, connectTimeout: TCP_TIMEOUT };
        if (ip === "127.0.0.1" || ip === "localhost") options.localAddress = "127.0.0.1";
        else options.interface = "wifi";

        const socket = TcpSocket.createConnection(options, () => {
          if (settled) return;
          settled = true;
          this.clientSocket = socket;
          if (typeof socket.setTimeout === "function") socket.setTimeout(0);
          this.startHeartbeat();
          console.log("Connected to device at", ip, port);
          this.connectionCallbacks.forEach((cb) => cb(true));
          resolve();
        });
        this.clientSocket = socket;
        socket.on("data", (data: any) => {
          try {
            const dataStr = decodeTcpData(data);
            const { messages } = this.messageProtocol.processData(dataStr);
            messages.forEach((msg) => this.messageCallbacks.forEach((cb) => cb(msg)));
          } catch (error) {
            console.error("Failed to process TCP data:", error);
          }
        });
        socket.on("error", (err: any) => {
          console.error("TCP client socket error:", err);
          if (!settled) {
            settled = true;
            if (this.clientSocket === socket) this.clientSocket = null;
            reject(err);
          }
        });
        socket.on("close", () => {
          console.log("TCP client disconnected");
          if (this.clientSocket === socket) this.clientSocket = null;
          if (!this.serverSocket) {
            this.stopHeartbeat();
            this.connectionCallbacks.forEach((cb) => cb(false));
          }
        });
      } catch (error) {
        if (!settled) {
          settled = true;
          this.clientSocket = null;
          reject(error);
        }
      }
    });
  }

  /** Send a framed message to the active connection. */
  async sendMessage(message: Message): Promise<void> {
    return new Promise((resolve, reject) => {
      const encoded = MessageProtocol.encode(message);
      const socket = this.getActiveSocket();
      if (!socket) {
        reject(new Error("No active TCP connection"));
        return;
      }
      socket.write(encoded, "utf-8", (err: any) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  onMessage(callback: (msg: Message) => void): void { this.messageCallbacks.push(callback); }
  onConnectionChange(callback: (connected: boolean) => void): void { this.connectionCallbacks.push(callback); }

  isConnected(): boolean {
    return !!this.getActiveSocket();
  }

  async disconnect(): Promise<void> {
    this.stopHeartbeat();
    if (this.clientSocket) { this.clientSocket.destroy(); this.clientSocket = null; }
    if (this.serverSocket) { this.serverSocket.destroy(); this.serverSocket = null; }
    this.connectionCallbacks.forEach((cb) => cb(false));
  }

  async stopServer(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    try {
      await new Promise<void>((resolve) => {
        try { server.close(() => resolve()); } catch { resolve(); }
      });
    } catch {}
  }

  async cleanup(): Promise<void> {
    this.stopHeartbeat();
    await this.disconnect();
    await this.stopServer();
    this.messageCallbacks = [];
    this.connectionCallbacks = [];
    this.messageProtocol.clearBuffer();
  }
}
