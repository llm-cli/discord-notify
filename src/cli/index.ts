#!/usr/bin/env node
import { program } from "commander";
import { sendCommand } from "./commands/send.js";
import { askCommand } from "./commands/ask.js";

program
  .name("discord-notify")
  .description("Send notifications to Discord DM from Claude agents")
  .version("1.0.0");

program
  .command("send <message>")
  .description("Send a message without waiting for response")
  .action(async (message: string) => {
    await sendCommand(message);
  });

program
  .command("ask <question>")
  .description("Ask a question and wait for response")
  .option("--options <choices>", "Comma-separated choices for buttons")
  .option("--no-wait", "Do not wait for response")
  .option("--timeout <ms>", "Timeout in milliseconds", "300000")
  .action(async (question: string, opts) => {
    const options = opts.options
      ? opts.options.split(",").map((s: string) => s.trim())
      : undefined;

    await askCommand(question, {
      options,
      noWait: !opts.wait, // commander inverts --no-X flags
      timeout: parseInt(opts.timeout, 10),
    });
  });

program.parse();
