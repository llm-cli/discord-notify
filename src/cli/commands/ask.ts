import { SocketClient } from "../socket-client.js";
import { loadConfigForCLI } from "../../shared/config.js";
import { resolveSessionInfo } from "../../daemon/session-resolver.js";

export interface AskOptions {
  options?: string[];
  noWait: boolean;
  timeout: number;
}

export async function askCommand(
  question: string,
  opts: AskOptions
): Promise<void> {
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
      type: "ask",
      data: {
        message: question,
        options: opts.options,
        sessionInfo,
        timeout: opts.timeout,
        noWait: opts.noWait,
      },
    });

    // Wait for ack
    const ack = await client.waitFor("ack");

    if (opts.noWait) {
      if (ack.type === "ack") {
        console.log(ack.data.requestId);
      }
      process.exit(0);
    }

    // Wait for response or timeout
    const result = await client.waitFor(["response", "timeout", "error"]);

    if (result.type === "response") {
      // Print response to stdout (for Claude to capture)
      console.log(result.data.response);
      process.exit(0);
    } else if (result.type === "timeout") {
      console.error("Timeout waiting for response");
      process.exit(1);
    } else if (result.type === "error") {
      console.error(`Error: ${result.data.message}`);
      process.exit(1);
    }
  } catch (err) {
    console.error("Error:", err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    client.disconnect();
  }
}
