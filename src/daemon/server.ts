import { createServer, Socket } from "node:net";
import { existsSync, unlinkSync } from "node:fs";
import type { Config } from "../shared/types.js";
import type { ClientMessage, ServerMessage } from "../shared/protocol.js";
import { PendingManager } from "./pending.js";
import { DiscordHandler } from "./discord.js";

interface ConnectedClient {
  socket: Socket;
  requestId?: string;
}

export class Server {
  private clients: Map<Socket, ConnectedClient> = new Map();
  private pendingManager: PendingManager;
  private discordHandler: DiscordHandler;

  constructor(private config: Config) {
    this.pendingManager = new PendingManager(config);
    this.discordHandler = new DiscordHandler(config, this.pendingManager);

    // Forward events from pending manager to connected clients
    this.pendingManager.on("response", (data) => {
      this.notifyClient(data.requestId, {
        type: "response",
        data: {
          requestId: data.requestId,
          response: data.response,
          answeredAt: data.answeredAt,
        },
      });
    });

    this.pendingManager.on("timeout", (data) => {
      this.notifyClient(data.requestId, {
        type: "timeout",
        data: { requestId: data.requestId },
      });
    });
  }

  async start(): Promise<void> {
    // Clean up old socket
    if (existsSync(this.config.socketPath)) {
      unlinkSync(this.config.socketPath);
    }

    // Start Discord client
    await this.discordHandler.start();

    // Start Unix socket server
    const server = createServer((socket) => {
      this.handleConnection(socket);
    });

    server.listen(this.config.socketPath, () => {
      console.log(`[Server] Listening on ${this.config.socketPath}`);
    });

    // Handle graceful shutdown
    process.on("SIGINT", () => this.shutdown(server));
    process.on("SIGTERM", () => this.shutdown(server));
  }

  private handleConnection(socket: Socket): void {
    console.log("[Server] Client connected");
    this.clients.set(socket, { socket });

    let buffer = "";

    socket.on("data", (data) => {
      buffer += data.toString();

      // Process complete messages (newline-delimited JSON)
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.trim()) {
          this.handleMessage(socket, line);
        }
      }
    });

    socket.on("close", () => {
      console.log("[Server] Client disconnected");
      this.clients.delete(socket);
    });

    socket.on("error", (err) => {
      console.error("[Server] Socket error:", err);
      this.clients.delete(socket);
    });
  }

  private async handleMessage(socket: Socket, raw: string): Promise<void> {
    let message: ClientMessage;

    try {
      message = JSON.parse(raw);
    } catch {
      this.send(socket, {
        type: "error",
        data: { code: "PARSE_ERROR", message: "Invalid JSON" },
      });
      return;
    }

    try {
      switch (message.type) {
        case "send":
          await this.handleSend(socket, message.data);
          break;
        case "ask":
          await this.handleAsk(socket, message.data);
          break;
        case "status":
          this.handleStatus(socket, message.data);
          break;
        case "cancel":
          this.handleCancel(socket, message.data);
          break;
        default:
          this.send(socket, {
            type: "error",
            data: { code: "UNKNOWN_TYPE", message: `Unknown message type` },
          });
      }
    } catch (err) {
      console.error("[Server] Error handling message:", err);
      this.send(socket, {
        type: "error",
        data: {
          code: "INTERNAL_ERROR",
          message: err instanceof Error ? err.message : "Unknown error",
        },
      });
    }
  }

  private async handleSend(
    socket: Socket,
    data: { message: string; sessionInfo: any }
  ): Promise<void> {
    const request = this.pendingManager.createRequest(
      "send",
      data.message,
      data.sessionInfo,
      { noWait: true }
    );

    const discordMessageId = await this.discordHandler.sendMessage(request);
    this.pendingManager.setDiscordMessageId(request.id, discordMessageId);

    this.send(socket, {
      type: "ack",
      data: { requestId: request.id, discordMessageId },
    });
  }

  private async handleAsk(
    socket: Socket,
    data: {
      message: string;
      options?: string[];
      sessionInfo: any;
      timeout?: number;
      noWait: boolean;
    }
  ): Promise<void> {
    const request = this.pendingManager.createRequest(
      "ask",
      data.message,
      data.sessionInfo,
      {
        options: data.options,
        timeout: data.timeout,
        noWait: data.noWait,
      }
    );

    // Associate this socket with the request for response routing
    const client = this.clients.get(socket);
    if (client) {
      client.requestId = request.id;
    }

    const discordMessageId = await this.discordHandler.sendMessage(request);
    this.pendingManager.setDiscordMessageId(request.id, discordMessageId);

    this.send(socket, {
      type: "ack",
      data: { requestId: request.id, discordMessageId },
    });
  }

  private handleStatus(socket: Socket, data: { requestId: string }): void {
    const request = this.pendingManager.getRequest(data.requestId);
    if (!request) {
      this.send(socket, {
        type: "error",
        data: { requestId: data.requestId, code: "NOT_FOUND", message: "Request not found" },
      });
      return;
    }

    // TODO: Return current status
  }

  private handleCancel(socket: Socket, data: { requestId: string }): void {
    this.pendingManager.cleanup(data.requestId);
    this.send(socket, {
      type: "ack",
      data: { requestId: data.requestId, discordMessageId: "" },
    });
  }

  private notifyClient(requestId: string, message: ServerMessage): void {
    for (const [, client] of this.clients) {
      if (client.requestId === requestId) {
        this.send(client.socket, message);
        return;
      }
    }
  }

  private send(socket: Socket, message: ServerMessage): void {
    socket.write(JSON.stringify(message) + "\n");
  }

  private shutdown(server: ReturnType<typeof createServer>): void {
    console.log("[Server] Shutting down...");
    server.close();
    this.discordHandler.stop();

    if (existsSync(this.config.socketPath)) {
      unlinkSync(this.config.socketPath);
    }

    process.exit(0);
  }
}
