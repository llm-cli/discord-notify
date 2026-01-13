// ============================================
// Configuration
// ============================================

export interface Config {
  socketPath: string;
  dataDir: string;
  discord: {
    token: string;
    userId: string;
  };
  timeouts: {
    defaultAsk: number;
    maxAsk: number;
  };
}

// ============================================
// Session Info
// ============================================

export interface SessionInfo {
  pid: number;
  sessionId?: string;
  sessionName?: string;
  cwd: string;
  projectName?: string;
}

// ============================================
// Pending Request
// ============================================

export interface PendingRequest {
  id: string;
  type: "send" | "ask";
  message: string;
  options?: string[];
  sessionInfo: SessionInfo;
  discordMessageId?: string;
  createdAt: number;
  timeout: number;
  noWait: boolean;
}

export type PendingStatus = "pending" | "answered" | "timeout" | "error";

export interface PendingResponse {
  requestId: string;
  status: PendingStatus;
  response?: string;
  answeredAt?: number;
  error?: string;
}

// ============================================
// Storage
// ============================================

export interface PendingStore {
  requests: Record<string, PendingRequest>;
  responses: Record<string, PendingResponse>;
}

export interface TerminalInfo {
  pid: number;
  kittyWindowId?: number;
  sessionId?: string;
  cwd: string;
  active: boolean;
}

export interface SessionStore {
  messageToRequest: Record<string, string>;
  requestToTerminal: Record<string, TerminalInfo>;
}
