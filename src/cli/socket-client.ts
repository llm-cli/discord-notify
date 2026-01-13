import { createConnection, Socket } from "node:net";
import type { ClientMessage, ServerMessage } from "../shared/protocol.js";

export class SocketClient {
  private socket: Socket | null = null;
  private buffer = "";
  private messageHandlers: Map<string, (msg: ServerMessage) => void> = new Map();
  private errorHandler: ((err: Error) => void) | null = null;

  async connect(socketPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = createConnection(socketPath, () => {
        resolve();
      });

      this.socket.on("error", (err) => {
        if (this.errorHandler) {
          this.errorHandler(err);
        }
        reject(err);
      });

      this.socket.on("data", (data) => {
        this.buffer += data.toString();

        const lines = this.buffer.split("\n");
        this.buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.trim()) {
            try {
              const message: ServerMessage = JSON.parse(line);
              this.handleMessage(message);
            } catch {
              // Ignore invalid JSON
            }
          }
        }
      });

      this.socket.on("close", () => {
        this.socket = null;
      });
    });
  }

  private handleMessage(message: ServerMessage): void {
    // Check for type-specific handlers
    const handler = this.messageHandlers.get(message.type);
    if (handler) {
      handler(message);
    }

    // Check for 'any' handler
    const anyHandler = this.messageHandlers.get("*");
    if (anyHandler) {
      anyHandler(message);
    }
  }

  send(message: ClientMessage): void {
    if (!this.socket) {
      throw new Error("Not connected");
    }
    this.socket.write(JSON.stringify(message) + "\n");
  }

  onMessage(type: string | "*", handler: (msg: ServerMessage) => void): void {
    this.messageHandlers.set(type, handler);
  }

  onError(handler: (err: Error) => void): void {
    this.errorHandler = handler;
  }

  async waitFor(types: string | string[]): Promise<ServerMessage> {
    const typeList = Array.isArray(types) ? types : [types];

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        for (const type of typeList) {
          this.messageHandlers.delete(type);
        }
        this.messageHandlers.delete("error");
      };

      for (const type of typeList) {
        this.messageHandlers.set(type, (msg) => {
          cleanup();
          resolve(msg);
        });
      }

      // Also handle errors
      this.messageHandlers.set("error", (msg) => {
        cleanup();
        if (msg.type === "error") {
          reject(new Error(msg.data.message));
        }
      });

      // Timeout after 10 minutes max
      setTimeout(() => {
        cleanup();
        reject(new Error("Timeout waiting for response"));
      }, 600000);
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.end();
      this.socket = null;
    }
  }
}
