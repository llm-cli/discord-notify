import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readdirSync } from "node:fs";

const execAsync = promisify(exec);

interface KittyWindow {
  id: number;
  pid: number;
  cwd: string;
  title: string;
  is_focused: boolean;
  foreground_processes: Array<{
    pid: number;
    cwd: string;
    cmdline: string[];
  }>;
}

interface KittyTab {
  id: number;
  is_focused: boolean;
  windows: KittyWindow[];
}

interface KittyOsWindow {
  id: number;
  is_focused: boolean;
  tabs: KittyTab[];
}

interface WindowMatch {
  socketPath: string;
  windowId: number;
  tabId: number;
}

class KittyControl {
  /**
   * Get all available kitty sockets
   */
  private getSocketPaths(): string[] {
    const sockets: string[] = [];

    try {
      const tmpFiles = readdirSync("/tmp");
      for (const f of tmpFiles) {
        if (f.startsWith("kitty-remote")) {
          sockets.push(`/tmp/${f}`);
        }
      }
    } catch {
      // /tmp not readable
    }

    return sockets;
  }

  /**
   * Check if kitty remote control is available (at least one socket exists)
   */
  async isAvailable(): Promise<boolean> {
    const sockets = this.getSocketPaths();
    return sockets.length > 0;
  }

  /**
   * Find a kitty window by the PID of a process running in it
   * Searches across ALL kitty sockets
   */
  async findWindowByPid(pid: number): Promise<WindowMatch | null> {
    const sockets = this.getSocketPaths();

    for (const socketPath of sockets) {
      try {
        const { stdout } = await execAsync(
          `kitty @ --to unix:${socketPath} ls 2>/dev/null`,
          { timeout: 5000 }
        );
        const osWindows: KittyOsWindow[] = JSON.parse(stdout);

        for (const osWindow of osWindows) {
          for (const tab of osWindow.tabs) {
            for (const window of tab.windows) {
              // Check if this window or any foreground process matches our PID
              if (window.pid === pid) {
                return { socketPath, windowId: window.id, tabId: tab.id };
              }

              // Check foreground processes (the actual running process)
              for (const fg of window.foreground_processes || []) {
                if (fg.pid === pid) {
                  return { socketPath, windowId: window.id, tabId: tab.id };
                }
              }
            }
          }
        }
      } catch {
        // Socket not responding, try next
      }
    }

    return null;
  }

  /**
   * Send text to a kitty window identified by PID
   */
  async sendText(pid: number, text: string): Promise<boolean> {
    const match = await this.findWindowByPid(pid);
    if (!match) {
      console.error(`[KittyControl] Could not find window for PID ${pid}`);
      return false;
    }

    try {
      const baseCmd = `kitty @ --to unix:${match.socketPath}`;

      // Escape text for shell (double quotes)
      const escapedText = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

      // Send text then press Enter
      await execAsync(
        `${baseCmd} send-text --match id:${match.windowId} "${escapedText}"`,
        { timeout: 5000 }
      );
      await execAsync(
        `${baseCmd} send-key --match id:${match.windowId} enter`,
        { timeout: 5000 }
      );

      console.log(
        `[KittyControl] Sent text + enter to window ${match.windowId} via ${match.socketPath}`
      );
      return true;
    } catch (e) {
      console.error("[KittyControl] Error sending text:", e);
      return false;
    }
  }

  /**
   * Send a key press to a kitty window
   */
  async sendKey(pid: number, key: string): Promise<boolean> {
    const match = await this.findWindowByPid(pid);
    if (!match) {
      return false;
    }

    try {
      const baseCmd = `kitty @ --to unix:${match.socketPath}`;
      await execAsync(
        `${baseCmd} send-key --match id:${match.windowId} ${key}`,
        { timeout: 5000 }
      );
      return true;
    } catch (e) {
      console.error("[KittyControl] Error sending key:", e);
      return false;
    }
  }
}

// Singleton instance
export const kittyControl = new KittyControl();
