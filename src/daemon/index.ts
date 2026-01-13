#!/usr/bin/env node
import { config as dotenvConfig } from "dotenv";
import { join } from "node:path";
import { homedir } from "node:os";

// Load .env from ~/.config/discord-notify/.env
dotenvConfig({ path: join(homedir(), ".config", "discord-notify", ".env") });

import { loadConfig } from "../shared/config.js";
import { Server } from "./server.js";

async function main() {
  console.log("[discord-notify-daemon] Starting...");

  try {
    const config = loadConfig();

    if (!config.discord.userId) {
      console.error("Error: discord.userId is not configured");
      console.error("Add it to ~/.config/discord-notify/config.json:");
      console.error('  { "discord": { "userId": "YOUR_USER_ID" } }');
      process.exit(1);
    }

    const server = new Server(config);
    await server.start();

    console.log("[discord-notify-daemon] Ready");
  } catch (err) {
    console.error("[discord-notify-daemon] Fatal error:", err);
    process.exit(1);
  }
}

main();
