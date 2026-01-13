import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { Config, PendingStore, PendingRequest, PendingResponse, SessionStore, TerminalInfo, SessionInfo } from "../shared/types.js";

export class PendingManager extends EventEmitter {
  private pendingPath: string;
  private sessionsPath: string;
  private pendingStore: PendingStore;
  private sessionStore: SessionStore;
  private timers: Map<string, NodeJS.Timeout> = new Map();

  constructor(private config: Config) {
    super();
    this.pendingPath = join(config.dataDir, "pending.json");
    this.sessionsPath = join(config.dataDir, "sessions.json");
    this.pendingStore = this.loadPendingStore();
    this.sessionStore = this.loadSessionStore();
  }

  private loadPendingStore(): PendingStore {
    if (existsSync(this.pendingPath)) {
      try {
        return JSON.parse(readFileSync(this.pendingPath, "utf-8"));
      } catch {
        // Corrupted file, start fresh
      }
    }
    return { requests: {}, responses: {} };
  }

  private loadSessionStore(): SessionStore {
    if (existsSync(this.sessionsPath)) {
      try {
        return JSON.parse(readFileSync(this.sessionsPath, "utf-8"));
      } catch {
        // Corrupted file, start fresh
      }
    }
    return { messageToRequest: {}, requestToTerminal: {} };
  }

  private savePendingStore(): void {
    writeFileSync(this.pendingPath, JSON.stringify(this.pendingStore, null, 2));
  }

  private saveSessionStore(): void {
    writeFileSync(this.sessionsPath, JSON.stringify(this.sessionStore, null, 2));
  }

  createRequest(
    type: "send" | "ask",
    message: string,
    sessionInfo: SessionInfo,
    options?: {
      options?: string[];
      timeout?: number;
      noWait?: boolean;
    }
  ): PendingRequest {
    const id = randomUUID();
    const request: PendingRequest = {
      id,
      type,
      message,
      options: options?.options,
      sessionInfo,
      createdAt: Date.now(),
      timeout: options?.timeout || this.config.timeouts.defaultAsk,
      noWait: options?.noWait || false,
    };

    this.pendingStore.requests[id] = request;
    this.savePendingStore();

    // Store terminal info
    this.sessionStore.requestToTerminal[id] = {
      pid: sessionInfo.pid,
      sessionId: sessionInfo.sessionId,
      cwd: sessionInfo.cwd,
      active: true,
    };
    this.saveSessionStore();

    return request;
  }

  setDiscordMessageId(requestId: string, discordMessageId: string): void {
    const request = this.pendingStore.requests[requestId];
    if (request) {
      request.discordMessageId = discordMessageId;
      this.savePendingStore();

      // Map Discord message to request
      this.sessionStore.messageToRequest[discordMessageId] = requestId;
      this.saveSessionStore();

      // Start timeout if it's an ask request
      if (request.type === "ask" && !request.noWait) {
        this.startTimeout(requestId, request.timeout);
      }
    }
  }

  getRequest(requestId: string): PendingRequest | undefined {
    return this.pendingStore.requests[requestId];
  }

  getRequestByMessageId(discordMessageId: string): PendingRequest | undefined {
    const requestId = this.sessionStore.messageToRequest[discordMessageId];
    if (requestId) {
      return this.pendingStore.requests[requestId];
    }
    return undefined;
  }

  getTerminal(requestId: string): TerminalInfo | undefined {
    return this.sessionStore.requestToTerminal[requestId];
  }

  setResponse(requestId: string, response: string): void {
    this.clearTimeout(requestId);

    this.pendingStore.responses[requestId] = {
      requestId,
      status: "answered",
      response,
      answeredAt: Date.now(),
    };
    this.savePendingStore();

    this.emit("response", { requestId, response, answeredAt: Date.now() });
  }

  private startTimeout(requestId: string, timeout: number): void {
    const timer = setTimeout(() => {
      this.handleTimeout(requestId);
    }, timeout);

    this.timers.set(requestId, timer);
  }

  private clearTimeout(requestId: string): void {
    const timer = this.timers.get(requestId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(requestId);
    }
  }

  private handleTimeout(requestId: string): void {
    this.timers.delete(requestId);

    this.pendingStore.responses[requestId] = {
      requestId,
      status: "timeout",
    };
    this.savePendingStore();

    this.emit("timeout", { requestId });
  }

  updateTerminalActive(requestId: string, active: boolean): void {
    const terminal = this.sessionStore.requestToTerminal[requestId];
    if (terminal) {
      terminal.active = active;
      this.saveSessionStore();
    }
  }

  cleanup(requestId: string): void {
    this.clearTimeout(requestId);

    const request = this.pendingStore.requests[requestId];
    if (request?.discordMessageId) {
      delete this.sessionStore.messageToRequest[request.discordMessageId];
    }

    delete this.pendingStore.requests[requestId];
    delete this.pendingStore.responses[requestId];
    delete this.sessionStore.requestToTerminal[requestId];

    this.savePendingStore();
    this.saveSessionStore();
  }
}
