import { existsSync, readFileSync, readlinkSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import type { SessionInfo } from "../shared/types.js";

/**
 * Resolve session info from the parent process (PPID)
 * This is called from the CLI to identify which Claude session is asking
 */
export async function resolveSessionInfo(): Promise<SessionInfo> {
  // Get parent PID (the shell running the CLI)
  const ppid = process.ppid;

  // Try to find the Claude process (might be PPID or its parent)
  let claudePid = ppid;
  let cwd = await getProcessCwd(ppid);

  // Check if PPID is claude, or if we need to go up the process tree
  const cmdline = await getProcessCmdline(ppid);
  if (!cmdline.includes("claude")) {
    // Try grandparent
    const grandparentPid = await getProcessPpid(ppid);
    if (grandparentPid) {
      const grandparentCmd = await getProcessCmdline(grandparentPid);
      if (grandparentCmd.includes("claude")) {
        claudePid = grandparentPid;
        cwd = await getProcessCwd(grandparentPid) || cwd;
      }
    }
  }

  // Try to find session ID
  const sessionId = await findSessionId(claudePid, cwd);
  const projectName = cwd ? basename(cwd) : undefined;

  // Try to get session name from theme
  const sessionName = sessionId
    ? await getSessionTheme(sessionId, cwd)
    : projectName;

  return {
    pid: claudePid,
    sessionId,
    sessionName,
    cwd: cwd || process.cwd(),
    projectName,
  };
}

async function getProcessCwd(pid: number): Promise<string | null> {
  const cwdPath = `/proc/${pid}/cwd`;
  if (existsSync(cwdPath)) {
    try {
      return readlinkSync(cwdPath);
    } catch {
      return null;
    }
  }
  return null;
}

async function getProcessCmdline(pid: number): Promise<string> {
  const cmdlinePath = `/proc/${pid}/cmdline`;
  if (existsSync(cmdlinePath)) {
    try {
      return readFileSync(cmdlinePath, "utf-8").replace(/\0/g, " ");
    } catch {
      return "";
    }
  }
  return "";
}

async function getProcessPpid(pid: number): Promise<number | null> {
  const statusPath = `/proc/${pid}/status`;
  if (existsSync(statusPath)) {
    try {
      const status = readFileSync(statusPath, "utf-8");
      const match = status.match(/^PPid:\s*(\d+)/m);
      if (match) {
        return parseInt(match[1], 10);
      }
    } catch {
      return null;
    }
  }
  return null;
}

async function findSessionId(pid: number, cwd: string | null): Promise<string | undefined> {
  if (!cwd) return undefined;

  const historyPath = join(homedir(), ".claude", "history.jsonl");
  if (!existsSync(historyPath)) return undefined;

  try {
    // Get process start time
    const elapsed = getProcessElapsedTime(pid);
    if (elapsed === null) return undefined;

    const startEpoch = Math.floor(Date.now() / 1000) - elapsed;

    // Read history.jsonl and find matching session
    const content = readFileSync(historyPath, "utf-8");
    const lines = content.trim().split("\n");

    // Search from most recent
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        if (entry.cwd === cwd || entry.project === cwd) {
          const entryTime = Math.floor(entry.timestamp / 1000);
          // Match within 60 seconds of process start
          if (Math.abs(entryTime - startEpoch) <= 60) {
            return entry.sessionId;
          }
        }
      } catch {
        // Skip invalid lines
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function getProcessElapsedTime(pid: number): number | null {
  try {
    const output = execSync(`ps -p ${pid} -o etimes=`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    return parseInt(output.trim(), 10);
  } catch {
    return null;
  }
}

async function getSessionTheme(
  sessionId: string,
  cwd: string | null
): Promise<string | undefined> {
  if (!cwd) return undefined;

  // Find session file
  const projectsDir = join(homedir(), ".claude", "projects");
  const encodedPath = cwd.replace(/\//g, "-");
  const sessionDir = join(projectsDir, encodedPath);

  if (!existsSync(sessionDir)) return undefined;

  const sessionFile = join(sessionDir, `${sessionId}.jsonl`);
  if (!existsSync(sessionFile)) return undefined;

  try {
    const content = readFileSync(sessionFile, "utf-8");
    const lines = content.trim().split("\n");

    // Look for summary entries (theme)
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === "summary" && entry.summary) {
          return entry.summary;
        }
      } catch {
        // Skip invalid lines
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}
