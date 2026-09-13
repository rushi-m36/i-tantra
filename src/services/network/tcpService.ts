import { AppState, type AppStateStatus } from "react-native";
import TcpSocket from "react-native-tcp-socket";
import { Message } from "../../types/communication";
import { MessageProtocol } from "./messageProtocol";

const SERVER_PORT = 5555;
const TCP_TIMEOUT = 10000;
const HEARTBEAT_INTERVAL = 5000;
const TCP_PROBE = "ITANTRA_PROBE_V1";
const SERVER_RESTART_DELAY = 500;

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
  private connectedPeerIp: string | null = null;
  private connectedPeerPort: number | null = null;
  private messageProtocol = new MessageProtocol();
  private messageCallbacks: Array<(msg: Message) => void> = [];
  private connectionCallbacks: Array<(connected: boolean) => void> = [];
  private server: any = null;
  private startPromise: Promise<number> | null = null;
  private stopPromise: Promise<void> | null = null;
  private serverListening = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private appStateSubscription: { remove: () => void } | null = null;
  private serverRestartTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(serverId: string) {
    this.serverId = serverId;
    this.appStateSubscription = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "background") {
        if (this.serverRestartTimer) {
          clearTimeout(this.serverRestartTimer);
          this.serverRestartTimer = null;
        }
        console.log("TCP server: releasing port 5555 for background service");
        void this.stopServer();
      } else if (state === "active") {
        if (this.serverRestartTimer) clearTimeout(this.serverRestartTimer);
        this.serverRestartTimer = setTimeout(() => {
          this.serverRestartTimer = null;
          console.log("TCP server: reclaiming port 5555 for foreground app");
          void this.startServer().catch((error) => console.error("TCP server restart failed:", error));
        }, SERVER_RESTART_DELAY);
      }
    });
  }

  private getActiveSocket(): any | null {
    const socket = this.clientSocket || this.serverSocket;
    return socket && !socket.destroyed ? socket : null;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      const socket = this.getActiveSocket();
      if (!socket) { this.stopHeartbeat(); return; }
      try {
        socket.write(MessageProtocol.encode({ type: "heartbeat", senderId: this.serverId, timestamp: Date.now() } as Message));
      } catch (error) { console.error("TCP heartbeat failed:", error); }
    }, HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
  }

  async startServer(): Promise<number> {
    if (this.stopPromise) await this.stopPromise;
    if (this.serverListening && this.server) return SERVER_PORT;
    if (this.startPromise) return this.startPromise;

    const startPromise = new Promise<number>((resolve, reject) => {
      let settled = false;
      const server = TcpSocket.createServer((socket: any) => {
        if (typeof socket.setTimeout === "function") socket.setTimeout(0);
        let isFirstData = true;
        let probeBuffer = "";
        let connectionActivated = false;
        const activateCommunicationSocket = () => {
          if (connectionActivated) return;
          connectionActivated = true;
          this.serverSocket = socket;
          this.startHeartbeat();
          this.connectionCallbacks.forEach((cb) => cb(true));
        };
        socket.on("data", (data: any) => {
          try {
            const dataStr = decodeTcpData(data);
            if (isFirstData) {
              probeBuffer += dataStr;
              const newlineIndex = probeBuffer.indexOf("\n");
              if (newlineIndex !== -1) {
                const firstLine = probeBuffer.slice(0, newlineIndex).trim();
                if (firstLine === TCP_PROBE) {
                  if (!socket.destroyed) {
                    socket.write(JSON.stringify({ magic: TCP_PROBE, id: this.serverId, name: this.serverId, port: SERVER_PORT }) + "\n", "utf-8", () => {
                      if (!socket.destroyed) socket.destroy();
                    });
                  }
                  return;
                }
                isFirstData = false;
                probeBuffer = "";
                activateCommunicationSocket();
              } else return;
            }
            if (!connectionActivated) return;
            const { messages } = this.messageProtocol.processData(dataStr);
            messages.forEach((msg) => this.messageCallbacks.forEach((cb) => cb(msg)));
          } catch (error) { console.error("Failed to process TCP data:", error); }
        });
        socket.on("error", (err: any) => console.error("TCP server socket error:", err));
        socket.on("close", () => {
          if (this.serverSocket === socket) this.serverSocket = null;
          if (connectionActivated && !this.clientSocket) {
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
          this.serverListening = false;
          if (this.server === server) this.server = null;
          if (this.startPromise === startPromise) this.startPromise = null;
          reject(err);
        }
      });
      server.on("close", () => {
        if (this.server === server) {
          this.server = null;
          this.serverListening = false;
        }
      });
      server.listen({ port: SERVER_PORT, host: "0.0.0.0", reuseAddress: true }, () => {
        if (settled) return;
        settled = true;
        this.serverListening = true;
        if (this.startPromise === startPromise) this.startPromise = null;
        console.log("TCP server: listening on port 5555");
        resolve(SERVER_PORT);
      });
    });

    this.startPromise = startPromise;
    return startPromise;
  }

  async connectToDevice(ip: string, port: number = SERVER_PORT): Promise<void> {
    if (this.clientSocket) { this.clientSocket.destroy(); this.clientSocket = null; this.connectedPeerIp = null; this.connectedPeerPort = null; }
    return new Promise((resolve, reject) => {
      let settled = false;
      try {
        const options: any = { host: ip, port, reuseAddress: true, connectTimeout: TCP_TIMEOUT };
        if (ip === "127.0.0.1" || ip === "localhost") options.localAddress = "127.0.0.1";
        const socket = TcpSocket.createConnection(options, () => {
          if (settled) return;
          settled = true;
          this.clientSocket = socket;
          this.connectedPeerIp = ip;
          this.connectedPeerPort = port;
          if (typeof socket.setTimeout === "function") socket.setTimeout(0);
          this.startHeartbeat();
          this.connectionCallbacks.forEach((cb) => cb(true));
          resolve();
        });
        this.clientSocket = socket;
        socket.on("data", (data: any) => {
          try {
            const dataStr = decodeTcpData(data);
            const { messages } = this.messageProtocol.processData(dataStr);
            messages.forEach((msg) => this.messageCallbacks.forEach((cb) => cb(msg)));
          } catch (error) { console.error("Failed to process TCP data:", error); }
        });
        socket.on("error", (err: any) => {
          console.error("TCP client socket error:", err);
          if (!settled) {
            settled = true;
            if (this.clientSocket === socket) this.clientSocket = null;
            if (this.connectedPeerIp === ip && this.connectedPeerPort === port) { this.connectedPeerIp = null; this.connectedPeerPort = null; }
            reject(err);
          }
        });
        socket.on("close", () => {
          if (this.clientSocket === socket) this.clientSocket = null;
          if (this.connectedPeerIp === ip && this.connectedPeerPort === port) { this.connectedPeerIp = null; this.connectedPeerPort = null; }
          if (!this.serverSocket) { this.stopHeartbeat(); this.connectionCallbacks.forEach((cb) => cb(false)); }
        });
      } catch (error) {
        if (!settled) { settled = true; this.clientSocket = null; this.connectedPeerIp = null; this.connectedPeerPort = null; reject(error); }
      }
    });
  }

  async sendMessage(message: Message): Promise<void> {
    return new Promise((resolve, reject) => {
      const encoded = MessageProtocol.encode(message);
      const socket = this.getActiveSocket();
      if (!socket) { reject(new Error("No active TCP connection")); return; }
      socket.write(encoded, "utf-8", (err: any) => { if (err) reject(err); else resolve(); });
    });
  }

  onMessage(callback: (msg: Message) => void): void { this.messageCallbacks.push(callback); }
  onConnectionChange(callback: (connected: boolean) => void): void { this.connectionCallbacks.push(callback); }
  isConnected(): boolean { return !!this.getActiveSocket(); }
  isConnectedTo(ip: string, port: number = SERVER_PORT): boolean { return this.isConnected() && this.connectedPeerIp === ip && this.connectedPeerPort === port; }

  async disconnect(): Promise<void> {
    this.stopHeartbeat();
    if (this.clientSocket) { this.clientSocket.destroy(); this.clientSocket = null; }
    this.connectedPeerIp = null; this.connectedPeerPort = null;
    if (this.serverSocket) { this.serverSocket.destroy(); this.serverSocket = null; }
    this.connectionCallbacks.forEach((cb) => cb(false));
  }

  async stopServer(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    const server = this.server;
    if (!server) return;

    this.serverListening = false;
    this.stopPromise = new Promise<void>((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        if (this.server === server) this.server = null;
        resolve();
      };
      try {
        server.close(finish);
      } catch {
        finish();
      }
    }).finally(() => {
      this.stopPromise = null;
    });
    await this.stopPromise;
  }

  async cleanup(): Promise<void> {
    this.stopHeartbeat();
    if (this.serverRestartTimer) { clearTimeout(this.serverRestartTimer); this.serverRestartTimer = null; }
    this.appStateSubscription?.remove();
    this.appStateSubscription = null;
    await this.disconnect();
    await this.stopServer();
    this.messageCallbacks = [];
    this.connectionCallbacks = [];
    this.messageProtocol.clearBuffer();
  }
}
