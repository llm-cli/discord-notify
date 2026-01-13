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

class KittyControl {
  private available: boolean | null = null;
  private socketPath: string | null = null;

  /**
   * Check if kitty remote control is available
   */
  async isAvailable(): Promise<boolean> {
    if (this.available !== null) {
      return this.available;
    }

    try {
      // Try to run kitty @ ls to check if remote control works
      const { stdout } = await execAsync("kitty @ ls 2>/dev/null", {
        timeout: 5000,
        env: { ...process.env, KITTY_LISTEN_ON: this.socketPath || "" },
      });

      // If we get valid JSON, remote control is available
      JSON.parse(stdout);
      this.available = true;
      console.log("[KittyControl] Remote control available");
      return true;
    } catch {
      // Try with common socket paths and patterns
      const uid = process.getuid?.() ?? 1000;

      // Find kitty sockets dynamically (kitty adds PID suffix)
      let dynamicSockets: string[] = [];
      try {
        const tmpFiles = readdirSync("/tmp");
        dynamicSockets = tmpFiles
          .filter((f) => f.startsWith("kitty-remote"))
          .map((f) => `/tmp/${f}`);
      } catch {
        // /tmp not readable
      }

      const socketPaths = [
        ...dynamicSockets,
        "/tmp/kitty-remote",
        `/tmp/kitty-${uid}`,
        `/run/user/${uid}/kitty`,
      ];

      for (const path of socketPaths) {
        try {
          const { stdout } = await execAsync(
            `kitty @ --to unix:${path} ls 2>/dev/null`,
            { timeout: 5000 }
          );
          JSON.parse(stdout);
          this.socketPath = path;
          this.available = true;
          console.log(
            `[KittyControl] Remote control available via socket: ${path}`
          );
          return true;
        } catch {
          // Try next path
        }
      }

      this.available = false;
      console.log("[KittyControl] Remote control not available");
      return false;
    }
  }

  /**
   * Find a kitty window by the PID of a process running in it
   */
  async findWindowByPid(
    pid: number
  ): Promise<{ windowId: number; tabId: number } | null> {
    if (!(await this.isAvailable())) {
      return null;
    }

    try {
      const cmd = this.socketPath
        ? `kitty @ --to unix:${this.socketPath} ls`
        : "kitty @ ls";

      const { stdout } = await execAsync(cmd, { timeout: 5000 });
      const osWindows: KittyOsWindow[] = JSON.parse(stdout);

      for (const osWindow of osWindows) {
        for (const tab of osWindow.tabs) {
          for (const window of tab.windows) {
            // Check if this window or any foreground process matches our PID
            if (window.pid === pid) {
              return { windowId: window.id, tabId: tab.id };
            }

            // Check foreground processes (the actual running process)
            for (const fg of window.foreground_processes || []) {
              if (fg.pid === pid) {
                return { windowId: window.id, tabId: tab.id };
              }
            }
          }
        }
      }

      return null;
    } catch (e) {
      console.error("[KittyControl] Error finding window:", e);
      return null;
    }
  }

  /**
   * Send text to a kitty window identified by PID
   */
  async sendText(pid: number, text: string): Promise<boolean> {
    if (!(await this.isAvailable())) {
      return false;
    }

    try {
      // Use --match to target the window by foreground process PID
      const baseCmd = this.socketPath
        ? `kitty @ --to unix:${this.socketPath}`
        : "kitty @";

      // Find window by foreground process PID
      const windowInfo = await this.findWindowByPid(pid);
      if (!windowInfo) {
        console.error(`[KittyControl] Could not find window for PID ${pid}`);
        return false;
      }

      // Escape text for shell (double quotes)
      const escapedText = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

      // Send text then press Enter
      await execAsync(
        `${baseCmd} send-text --match id:${windowInfo.windowId} "${escapedText}"`,
        { timeout: 5000 }
      );
      await execAsync(
        `${baseCmd} send-key --match id:${windowInfo.windowId} enter`,
        { timeout: 5000 }
      );

      console.log(
        `[KittyControl] Sent text + enter to window ID ${windowInfo.windowId}`
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
    if (!(await this.isAvailable())) {
      return false;
    }

    try {
      const baseCmd = this.socketPath
        ? `kitty @ --to unix:${this.socketPath}`
        : "kitty @";

      const windowInfo = await this.findWindowByPid(pid);
      if (!windowInfo) {
        return false;
      }

      await execAsync(
        `${baseCmd} send-key --match id:${windowInfo.windowId} ${key}`,
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
