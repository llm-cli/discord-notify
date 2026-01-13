import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Config } from "./types.js";

const DEFAULT_CONFIG: Omit<Config, "discord"> & { discord: Omit<Config["discord"], "token"> } = {
  socketPath: "/tmp/discord-notify.sock",
  dataDir: join(homedir(), ".discord-notify"),
  discord: {
    userId: "",
  },
  timeouts: {
    defaultAsk: 300000, // 5 min
    maxAsk: 3600000, // 1 hour
  },
};

export function loadConfig(): Config {
  const configPaths = [
    join(homedir(), ".config", "discord-notify", "config.json"),
    join(homedir(), ".discord-notify", "config.json"),
  ];

  let fileConfig: Partial<Config> = {};

  for (const configPath of configPaths) {
    if (existsSync(configPath)) {
      try {
        const content = readFileSync(configPath, "utf-8");
        fileConfig = JSON.parse(content);
        break;
      } catch (e) {
        console.error(`Error reading config from ${configPath}:`, e);
      }
    }
  }

  // Load token from environment
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    throw new Error("DISCORD_TOKEN environment variable is required");
  }

  const config: Config = {
    socketPath: fileConfig.socketPath || DEFAULT_CONFIG.socketPath,
    dataDir: fileConfig.dataDir || DEFAULT_CONFIG.dataDir,
    discord: {
      token,
      userId: fileConfig.discord?.userId || DEFAULT_CONFIG.discord.userId,
    },
    timeouts: {
      defaultAsk: fileConfig.timeouts?.defaultAsk || DEFAULT_CONFIG.timeouts.defaultAsk,
      maxAsk: fileConfig.timeouts?.maxAsk || DEFAULT_CONFIG.timeouts.maxAsk,
    },
  };

  // Ensure data directory exists
  if (!existsSync(config.dataDir)) {
    mkdirSync(config.dataDir, { recursive: true });
  }

  return config;
}

export function loadConfigForCLI(): Pick<Config, "socketPath"> {
  const configPaths = [
    join(homedir(), ".config", "discord-notify", "config.json"),
    join(homedir(), ".discord-notify", "config.json"),
  ];

  for (const configPath of configPaths) {
    if (existsSync(configPath)) {
      try {
        const content = readFileSync(configPath, "utf-8");
        const fileConfig = JSON.parse(content);
        return {
          socketPath: fileConfig.socketPath || DEFAULT_CONFIG.socketPath,
        };
      } catch {
        // Continue to next config path
      }
    }
  }

  return { socketPath: DEFAULT_CONFIG.socketPath };
}
