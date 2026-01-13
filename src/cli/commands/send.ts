import { SocketClient } from "../socket-client.js";
import { loadConfigForCLI } from "../../shared/config.js";
import { resolveSessionInfo } from "../../daemon/session-resolver.js";

export async function sendCommand(message: string): Promise<void> {
  const config = loadConfigForCLI();
  const client = new SocketClient();

  try {
    await client.connect(config.socketPath);
  } catch (err) {
    console.error("Error: Could not connect to daemon");
    console.error("Make sure discord-notify-daemon is running");
    process.exit(1);
  }

  try {
    const sessionInfo = await resolveSessionInfo();

    client.send({
      type: "send",
      data: {
        message,
        sessionInfo,
      },
    });

    // Wait for ack
    const ack = await client.waitFor("ack");
    if (ack.type === "ack") {
      // Success, exit silently
      process.exit(0);
    }
  } catch (err) {
    console.error("Error:", err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    client.disconnect();
  }
}
