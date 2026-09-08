import TcpSocket from "react-native-tcp-socket";
import { Message } from "../../types/communication";
import { MessageProtocol } from "./messageProtocol";

const SERVER_PORT = 5555;
const TCP_TIMEOUT = 30000;

export class TCPService {
  private serverId: string;
  private serverSocket: any = null;
  private clientSocket: any = null;
  private messageProtocol = new MessageProtocol();
  private messageCallbacks: Array<(msg: Message) => void> = [];
  private connectionCallbacks: Array<(connected: boolean) => void> = [];
  private server: any = null;

  constructor(serverId: string) {
    this.serverId = serverId;
  }

  /**
   * Start TCP server
   */
  async startServer(): Promise<number> {
    return new Promise((resolve, reject) => {
      try {
        this.server = TcpSocket.createServer((socket: any) => {
          console.log("Client connected:", socket.address());
          this.serverSocket = socket;
          this.connectionCallbacks.forEach((cb) => cb(true));

          socket.on("data", (data: any) => {
            const dataStr = Buffer.from(data).toString("utf-8");
            const { messages } = this.messageProtocol.processData(dataStr);
            messages.forEach((msg) => {
              this.messageCallbacks.forEach((cb) => cb(msg));
            });
          });

          socket.on("error", (err: any) => {
            console.error("Server socket error:", err);
          });

          socket.on("close", () => {
            console.log("Server client disconnected");
            this.serverSocket = null;
            this.connectionCallbacks.forEach((cb) => cb(false));
          });
        });

        this.server.listen({ port: SERVER_PORT }, () => {
          console.log("TCP Server listening on port", SERVER_PORT);
          resolve(SERVER_PORT);
        });

        this.server.on("error", (err: any) => {
          console.error("Server error:", err);
          // Try to reuse port if already in use
          if (err.code === "EADDRINUSE") {
            console.log("Port already in use, attempting to reuse...");
            this.server.close(() => {
              // Retry after small delay
              setTimeout(() => {
                this.server.listen({ port: SERVER_PORT }, () => {
                  console.log("TCP Server listening on port", SERVER_PORT);
                  resolve(SERVER_PORT);
                });
              }, 100);
            });
          } else {
            reject(err);
          }
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * Connect to remote device
   */
  async connectToDevice(ip: string, port: number = SERVER_PORT): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.clientSocket = TcpSocket.createConnection(
          { host: ip, port },
          () => {
            console.log("Connected to device at", ip, port);
            this.connectionCallbacks.forEach((cb) => cb(true));
            resolve();
          },
        );

        this.clientSocket.on("data", (data: any) => {
          const dataStr = Buffer.from(data).toString("utf-8");
          const { messages } = this.messageProtocol.processData(dataStr);
          messages.forEach((msg) => {
            this.messageCallbacks.forEach((cb) => cb(msg));
          });
        });

        this.clientSocket.on("error", (err: any) => {
          console.error("Client socket error:", err);
          reject(err);
        });

        this.clientSocket.on("close", () => {
          console.log("Disconnected from device");
          this.clientSocket = null;
          this.connectionCallbacks.forEach((cb) => cb(false));
        });

        setTimeout(() => {
          if (this.clientSocket) reject(new Error("Connection timeout"));
        }, TCP_TIMEOUT);
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * Send message to connected device
   */
  async sendMessage(message: Message): Promise<void> {
    return new Promise((resolve, reject) => {
      const encoded = MessageProtocol.encode(message);
      const socket = this.clientSocket || this.serverSocket;

      if (!socket) {
        reject(new Error("No active connection"));
        return;
      }

      socket.write(encoded, "utf-8", (err: any) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Register callback for incoming messages
   */
  onMessage(callback: (msg: Message) => void): void {
    this.messageCallbacks.push(callback);
  }

  /**
   * Register callback for connection changes
   */
  onConnectionChange(callback: (connected: boolean) => void): void {
    this.connectionCallbacks.push(callback);
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return !!(this.clientSocket || this.serverSocket);
  }

  /**
   * Disconnect
   */
  async disconnect(): Promise<void> {
    return new Promise((resolve) => {
      if (this.clientSocket) {
        this.clientSocket.destroy();
        this.clientSocket = null;
      }
      if (this.serverSocket) {
        this.serverSocket.destroy();
        this.serverSocket = null;
      }
      this.connectionCallbacks.forEach((cb) => cb(false));
      resolve();
    });
  }

  /**
   * Stop server
   */
  async stopServer(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Cleanup
   */
  async cleanup(): Promise<void> {
    await this.disconnect();
    await this.stopServer();
    this.messageCallbacks = [];
    this.connectionCallbacks = [];
    this.messageProtocol.clearBuffer();
  }
}
