import type { SessionInfo } from "./types.js";

// ============================================
// CLI -> Daemon Messages
// ============================================

export interface SendMessage {
  type: "send";
  data: {
    message: string;
    sessionInfo: SessionInfo;
  };
}

export interface AskMessage {
  type: "ask";
  data: {
    message: string;
    options?: string[];
    sessionInfo: SessionInfo;
    timeout?: number;
    noWait: boolean;
  };
}

export interface StatusMessage {
  type: "status";
  data: {
    requestId: string;
  };
}

export interface CancelMessage {
  type: "cancel";
  data: {
    requestId: string;
  };
}

export type ClientMessage = SendMessage | AskMessage | StatusMessage | CancelMessage;

// ============================================
// Daemon -> CLI Messages
// ============================================

export interface AckMessage {
  type: "ack";
  data: {
    requestId: string;
    discordMessageId: string;
  };
}

export interface ResponseMessage {
  type: "response";
  data: {
    requestId: string;
    response: string;
    answeredAt: number;
  };
}

export interface ErrorMessage {
  type: "error";
  data: {
    requestId?: string;
    code: string;
    message: string;
  };
}

export interface TimeoutMessage {
  type: "timeout";
  data: {
    requestId: string;
  };
}

export type ServerMessage = AckMessage | ResponseMessage | ErrorMessage | TimeoutMessage;
