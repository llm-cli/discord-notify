import {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Partials,
  Message,
  ButtonInteraction,
  EmbedBuilder,
} from "discord.js";
import type { Config, PendingRequest } from "../shared/types.js";
import type { PendingManager } from "./pending.js";
import { kittyControl } from "../utils/kitty.js";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

export class DiscordHandler {
  private client: Client;
  private userId: string;
  private ready = false;

  constructor(
    private config: Config,
    private pendingManager: PendingManager
  ) {
    this.userId = config.discord.userId;

    this.client = new Client({
      intents: [
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Channel, Partials.Message],
    });

    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.client.on("ready", () => {
      console.log(`[Discord] Logged in as ${this.client.user?.tag}`);
      this.ready = true;
    });

    // Handle replies to messages
    this.client.on("messageCreate", async (message: Message) => {
      await this.handleMessage(message);
    });

    // Handle button interactions
    this.client.on("interactionCreate", async (interaction) => {
      if (interaction.isButton()) {
        await this.handleButton(interaction as ButtonInteraction);
      }
    });
  }

  private async handleMessage(message: Message): Promise<void> {
    // Ignore bot messages
    if (message.author.bot) return;

    // Only DMs from the configured user
    if (!message.channel.isDMBased()) return;
    if (message.author.id !== this.userId) return;

    // Check if it's a reply
    if (!message.reference?.messageId) return;

    const originalMessageId = message.reference.messageId;
    const request = this.pendingManager.getRequestByMessageId(originalMessageId);

    if (!request) return;

    console.log(`[Discord] Received reply for request ${request.id}: ${message.content}`);
    await this.processResponse(request.id, message.content);
  }

  private async handleButton(interaction: ButtonInteraction): Promise<void> {
    // customId format: "req:<requestId>:<optionIndex>"
    const parts = interaction.customId.split(":");
    if (parts[0] !== "req" || parts.length !== 3) return;

    const [, requestId, optionIndexStr] = parts;
    const optionIndex = parseInt(optionIndexStr, 10);

    const request = this.pendingManager.getRequest(requestId);
    if (!request || !request.options) return;

    const response = request.options[optionIndex];
    if (!response) return;

    console.log(`[Discord] Button clicked for request ${requestId}: ${response}`);

    // Acknowledge the button click and update message
    try {
      const originalEmbed = interaction.message.embeds[0];
      if (originalEmbed) {
        const updatedEmbed = EmbedBuilder.from(originalEmbed)
          .setColor(0x57F287) // Green for answered
          .setDescription(`${originalEmbed.description}\n\n✅ **${response}**`);

        await interaction.update({
          embeds: [updatedEmbed],
          components: [], // Remove buttons
        });
      } else {
        await interaction.update({
          content: `✅ **${response}**`,
          components: [],
        });
      }
    } catch (err) {
      console.error("[Discord] Error updating button interaction:", err);
    }

    await this.processResponse(requestId, response);
  }

  private async processResponse(requestId: string, response: string): Promise<void> {
    const terminal = this.pendingManager.getTerminal(requestId);

    // Check if process is still alive
    if (terminal && !this.isProcessAlive(terminal.pid)) {
      console.log(`[Discord] Process ${terminal.pid} is dead, attempting resume...`);
      this.pendingManager.updateTerminalActive(requestId, false);

      // Try to resume the session
      if (terminal.sessionId) {
        await this.resumeAndInject(terminal.sessionId, terminal.cwd, response);
      } else {
        console.log("[Discord] No sessionId available for resume");
      }
    }

    // Always set the response (CLI might still be waiting or it's stored for later)
    this.pendingManager.setResponse(requestId, response);
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private async resumeAndInject(
    sessionId: string,
    cwd: string,
    message: string
  ): Promise<void> {
    console.log(`[Discord] Resuming session ${sessionId} in ${cwd}`);

    try {
      // Spawn new Kitty window with claude --resume
      const kittyProcess = spawn(
        "kitty",
        [
          "--detach",
          "--directory",
          cwd,
          "-e",
          "claude",
          "--dangerously-skip-permissions",
          "--resume",
          sessionId,
        ],
        { detached: true, stdio: "ignore" }
      );
      kittyProcess.unref();

      // Wait for Claude to be ready
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Find the new process and inject message
      // Note: This is tricky because we don't have the new PID
      // We'll try to find it by scanning for claude processes in that cwd
      const newPid = await this.findClaudeProcessInCwd(cwd);
      if (newPid) {
        console.log(`[Discord] Found new process ${newPid}, injecting message`);
        await kittyControl.sendText(newPid, message);
      } else {
        console.log("[Discord] Could not find new Claude process to inject message");
      }
    } catch (err) {
      console.error("[Discord] Error resuming session:", err);
    }
  }

  private async findClaudeProcessInCwd(cwd: string): Promise<number | null> {
    const { execSync } = await import("node:child_process");

    try {
      // Find claude processes
      const output = execSync("ps aux | grep '[c]laude'", { encoding: "utf-8" });
      const lines = output.trim().split("\n");

      for (const line of lines) {
        const parts = line.split(/\s+/);
        const pid = parseInt(parts[1], 10);

        // Check if this process is in the target cwd
        const procCwd = `/proc/${pid}/cwd`;
        if (existsSync(procCwd)) {
          const { readlinkSync } = await import("node:fs");
          const processCwd = readlinkSync(procCwd);
          if (processCwd === cwd) {
            return pid;
          }
        }
      }
    } catch {
      // No claude processes found
    }

    return null;
  }

  async start(): Promise<void> {
    await this.client.login(this.config.discord.token);

    // Wait for ready
    if (!this.ready) {
      await new Promise<void>((resolve) => {
        this.client.once("ready", () => resolve());
      });
    }
  }

  stop(): void {
    this.client.destroy();
  }

  async sendMessage(request: PendingRequest): Promise<string> {
    const user = await this.client.users.fetch(this.userId);
    const dm = await user.createDM();

    const embed = this.buildEmbed(request);

    const messageOptions: {
      embeds: EmbedBuilder[];
      components?: ActionRowBuilder<ButtonBuilder>[];
    } = { embeds: [embed] };

    // Add buttons if options provided
    if (request.options && request.options.length > 0) {
      const row = new ActionRowBuilder<ButtonBuilder>();
      request.options.forEach((option, index) => {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`req:${request.id}:${index}`)
            .setLabel(option.slice(0, 80)) // Discord button label max 80 chars
            .setStyle(ButtonStyle.Primary)
        );
      });
      messageOptions.components = [row];
    }

    const sentMessage = await dm.send(messageOptions);
    console.log(`[Discord] Sent message ${sentMessage.id} for request ${request.id}`);

    return sentMessage.id;
  }

  private buildEmbed(request: PendingRequest): EmbedBuilder {
    const { sessionInfo, message, type } = request;
    const name = sessionInfo.sessionName || sessionInfo.projectName || "session";

    const embed = new EmbedBuilder()
      .setColor(type === "ask" ? 0x5865F2 : 0x57F287)
      .setDescription(message)
      .setFooter({ text: `${name} • PID ${sessionInfo.pid}` });

    return embed;
  }
}
