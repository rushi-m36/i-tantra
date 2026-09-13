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
    console.log(`[TCP DEBUG] TCPService constructed id=${serverId}`);
    this.appStateSubscription = AppState.addEventListener("change", (state: AppStateStatus) => {
      console.log(`[TCP DEBUG] AppState changed -> ${state}; serverListening=${this.serverListening}`);
      if (state === "background") {
        if (this.serverRestartTimer) { clearTimeout(this.serverRestartTimer); this.serverRestartTimer = null; }
        console.log("[TCP DEBUG] BACKGROUND: requesting foreground TCP server shutdown");
        void this.stopServer();
      } else if (state === "active") {
        if (this.serverRestartTimer) clearTimeout(this.serverRestartTimer);
        this.serverRestartTimer = setTimeout(() => {
          this.serverRestartTimer = null;
          console.log("[TCP DEBUG] ACTIVE: requesting foreground TCP server startup");
          void this.startServer().catch((error) => console.error("[TCP DEBUG] foreground server restart FAILED", error));
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
    console.log("[TCP DEBUG] heartbeat START");
    this.heartbeatTimer = setInterval(() => {
      const socket = this.getActiveSocket();
      if (!socket) { this.stopHeartbeat(); return; }
      try { socket.write(MessageProtocol.encode({ type: "heartbeat", senderId: this.serverId, timestamp: Date.now() } as Message)); }
      catch (error) { console.error("[TCP DEBUG] heartbeat FAILED", error); }
    }, HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; console.log("[TCP DEBUG] heartbeat STOP"); }
  }

  async startServer(): Promise<number> {
    console.log(`[TCP DEBUG] startServer ENTER listening=${this.serverListening} server=${!!this.server} startPromise=${!!this.startPromise} stopPromise=${!!this.stopPromise}`);
    if (this.stopPromise) { console.log("[TCP DEBUG] startServer waiting for previous stop"); await this.stopPromise; }
    if (this.serverListening && this.server) { console.log("[TCP DEBUG] startServer: already listening; no new server created"); return SERVER_PORT; }
    if (this.startPromise) { console.log("[TCP DEBUG] startServer: joining existing startup promise"); return this.startPromise; }

    const startPromise = new Promise<number>((resolve, reject) => {
      let settled = false;
      const server = TcpSocket.createServer((socket: any) => {
        console.log(`[TCP DEBUG] SERVER accepted socket remote=${socket.remoteAddress}:${socket.remotePort}`);
        if (typeof socket.setTimeout === "function") socket.setTimeout(0);
        let isFirstData = true;
        let probeBuffer = "";
        let connectionActivated = false;
        const activateCommunicationSocket = () => {
          if (connectionActivated) return;
          connectionActivated = true;
          this.serverSocket = socket;
          console.log("[TCP DEBUG] SERVER socket ACTIVATED for communication");
          this.startHeartbeat();
          this.connectionCallbacks.forEach((cb) => cb(true));
        };
        socket.on("data", (data: any) => {
          try {
            const dataStr = decodeTcpData(data);
            console.log(`[TCP DEBUG] SERVER received ${dataStr.length} bytes: ${JSON.stringify(dataStr)}`);
            if (isFirstData) {
              probeBuffer += dataStr;
              const newlineIndex = probeBuffer.indexOf("\n");
              if (newlineIndex !== -1) {
                const firstLine = probeBuffer.slice(0, newlineIndex).trim();
                console.log(`[TCP DEBUG] SERVER first line=${JSON.stringify(firstLine)}`);
                if (firstLine === TCP_PROBE) {
                  console.log("[TCP DEBUG] SERVER probe detected; replying and closing probe socket");
                  if (!socket.destroyed) socket.write(JSON.stringify({ magic: TCP_PROBE, id: this.serverId, name: this.serverId, port: SERVER_PORT }) + "\n", "utf-8", () => { if (!socket.destroyed) socket.destroy(); });
                  return;
                }
                isFirstData = false;
                probeBuffer = "";
                activateCommunicationSocket();
              } else return;
            }
            if (!connectionActivated) return;
            const { messages } = this.messageProtocol.processData(dataStr);
            messages.forEach((msg) => { console.log(`[TCP DEBUG] SERVER parsed message type=${msg.type}`); this.messageCallbacks.forEach((cb) => cb(msg)); });
          } catch (error) { console.error("[TCP DEBUG] SERVER data processing FAILED", error); }
        });
        socket.on("error", (err: any) => console.error("[TCP DEBUG] SERVER socket ERROR", err));
        socket.on("close", () => {
          console.log(`[TCP DEBUG] SERVER socket CLOSE activated=${connectionActivated}`);
          if (this.serverSocket === socket) this.serverSocket = null;
          if (connectionActivated && !this.clientSocket) { this.stopHeartbeat(); this.connectionCallbacks.forEach((cb) => cb(false)); }
        });
      });

      this.server = server;
      console.log("[TCP DEBUG] SERVER object created; calling listen(:5555)");
      server.on("error", (err: any) => {
        console.error("[TCP DEBUG] SERVER ERROR", err);
        if (!settled) {
          settled = true; this.serverListening = false;
          if (this.server === server) this.server = null;
          if (this.startPromise === startPromise) this.startPromise = null;
          reject(err);
        }
      });
      server.on("close", () => {
        console.log("[TCP DEBUG] SERVER close event");
        if (this.server === server) { this.server = null; this.serverListening = false; }
      });
      server.listen({ port: SERVER_PORT, host: "0.0.0.0", reuseAddress: true }, () => {
        if (settled) return;
        settled = true; this.serverListening = true;
        if (this.startPromise === startPromise) this.startPromise = null;
        console.log("[TCP DEBUG] SERVER LISTENING :5555");
        resolve(SERVER_PORT);
      });
    });
    this.startPromise = startPromise;
    return startPromise;
  }

  async connectToDevice(ip: string, port: number = SERVER_PORT): Promise<void> {
    console.log(`[TCP DEBUG] connectToDevice ENTER target=${ip}:${port} existingClient=${!!this.clientSocket} existingServerSocket=${!!this.serverSocket}`);
    if (this.clientSocket) { console.log("[TCP DEBUG] destroying previous client socket before reconnect"); this.clientSocket.destroy(); this.clientSocket = null; this.connectedPeerIp = null; this.connectedPeerPort = null; }
    return new Promise((resolve, reject) => {
      let settled = false;
      try {
        const options: any = { host: ip, port, reuseAddress: true, connectTimeout: TCP_TIMEOUT };
        if (ip === "127.0.0.1" || ip === "localhost") options.localAddress = "127.0.0.1";
        console.log(`[TCP DEBUG] createConnection options=${JSON.stringify(options)}`);
        const socket = TcpSocket.createConnection(options, () => {
          if (settled) return;
          settled = true; this.clientSocket = socket; this.connectedPeerIp = ip; this.connectedPeerPort = port;
          if (typeof socket.setTimeout === "function") socket.setTimeout(0);
          console.log(`[TCP DEBUG] CLIENT CONNECTED to ${ip}:${port}`);
          this.startHeartbeat(); this.connectionCallbacks.forEach((cb) => cb(true)); resolve();
        });
        this.clientSocket = socket;
        socket.on("data", (data: any) => {
          try { const dataStr = decodeTcpData(data); console.log(`[TCP DEBUG] CLIENT received ${dataStr.length} bytes: ${JSON.stringify(dataStr)}`); const { messages } = this.messageProtocol.processData(dataStr); messages.forEach((msg) => { console.log(`[TCP DEBUG] CLIENT parsed message type=${msg.type}`); this.messageCallbacks.forEach((cb) => cb(msg)); }); }
          catch (error) { console.error("[TCP DEBUG] CLIENT data processing FAILED", error); }
        });
        socket.on("error", (err: any) => {
          console.error(`[TCP DEBUG] CLIENT ERROR target=${ip}:${port}`, err);
          if (!settled) { settled = true; if (this.clientSocket === socket) this.clientSocket = null; this.connectedPeerIp = null; this.connectedPeerPort = null; reject(err); }
        });
        socket.on("close", () => {
          console.log(`[TCP DEBUG] CLIENT socket CLOSE target=${ip}:${port}`);
          if (this.clientSocket === socket) this.clientSocket = null;
          if (this.connectedPeerIp === ip && this.connectedPeerPort === port) { this.connectedPeerIp = null; this.connectedPeerPort = null; }
          if (!this.serverSocket) { this.stopHeartbeat(); this.connectionCallbacks.forEach((cb) => cb(false)); }
        });
      } catch (error) { console.error("[TCP DEBUG] createConnection threw", error); if (!settled) { settled = true; this.clientSocket = null; this.connectedPeerIp = null; this.connectedPeerPort = null; reject(error); } }
    });
  }

  async sendMessage(message: Message): Promise<void> {
    const socket = this.getActiveSocket();
    console.log(`[TCP DEBUG] sendMessage type=${message.type} activeSocket=${!!socket} client=${!!this.clientSocket} serverSocket=${!!this.serverSocket}`);
    return new Promise((resolve, reject) => {
      const encoded = MessageProtocol.encode(message);
      if (!socket) { reject(new Error("No active TCP connection")); return; }
      console.log(`[TCP DEBUG] sending ${encoded.length} bytes: ${encoded.trim()}`);
      socket.write(encoded, "utf-8", (err: any) => { if (err) { console.error("[TCP DEBUG] sendMessage write FAILED", err); reject(err); } else { console.log(`[TCP DEBUG] sendMessage type=${message.type} SENT`); resolve(); } });
    });
  }

  onMessage(callback: (msg: Message) => void): void { this.messageCallbacks.push(callback); console.log(`[TCP DEBUG] onMessage callback registered count=${this.messageCallbacks.length}`); }
  onConnectionChange(callback: (connected: boolean) => void): void { this.connectionCallbacks.push(callback); console.log(`[TCP DEBUG] onConnectionChange callback registered count=${this.connectionCallbacks.length}`); }
  isConnected(): boolean { return !!this.getActiveSocket(); }
  isConnectedTo(ip: string, port: number = SERVER_PORT): boolean { return this.isConnected() && this.connectedPeerIp === ip && this.connectedPeerPort === port; }

  async disconnect(): Promise<void> {
    console.log(`[TCP DEBUG] disconnect ENTER client=${!!this.clientSocket} serverSocket=${!!this.serverSocket}`);
    this.stopHeartbeat();
    if (this.clientSocket) { this.clientSocket.destroy(); this.clientSocket = null; }
    this.connectedPeerIp = null; this.connectedPeerPort = null;
    if (this.serverSocket) { this.serverSocket.destroy(); this.serverSocket = null; }
    this.connectionCallbacks.forEach((cb) => cb(false));
    console.log("[TCP DEBUG] disconnect EXIT");
  }

  async stopServer(): Promise<void> {
    console.log(`[TCP DEBUG] stopServer ENTER listening=${this.serverListening} server=${!!this.server} stopPromise=${!!this.stopPromise}`);
    if (this.stopPromise) return this.stopPromise;
    const server = this.server;
    if (!server) { console.log("[TCP DEBUG] stopServer: no server object"); return; }
    this.serverListening = false;
    this.stopPromise = new Promise<void>((resolve) => {
      let finished = false;
      const finish = () => { if (finished) return; finished = true; console.log("[TCP DEBUG] stopServer FINISHED; port released"); if (this.server === server) this.server = null; resolve(); };
      try { server.close(finish); } catch (error) { console.error("[TCP DEBUG] server.close threw", error); finish(); }
    }).finally(() => { this.stopPromise = null; });
    await this.stopPromise;
  }

  async cleanup(): Promise<void> {
    console.log("[TCP DEBUG] cleanup ENTER");
    this.stopHeartbeat();
    if (this.serverRestartTimer) { clearTimeout(this.serverRestartTimer); this.serverRestartTimer = null; }
    this.appStateSubscription?.remove(); this.appStateSubscription = null;
    await this.disconnect(); await this.stopServer();
    this.messageCallbacks = []; this.connectionCallbacks = []; this.messageProtocol.clearBuffer();
    console.log("[TCP DEBUG] cleanup EXIT");
  }
}
