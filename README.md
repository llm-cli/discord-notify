# discord-notify

CLI to communicate with users via Discord DM. Designed for AI agents.

## Install

```bash
git clone https://github.com/llm-cli/discord-notify
cd discord-notify
pnpm install && pnpm build
pnpm link --global
```

## Setup

1. Create a Discord bot at https://discord.com/developers/applications
2. Enable "Message Content Intent" in Bot settings
3. Add bot to a server (required for DMs)

```bash
mkdir -p ~/.config/discord-notify
echo "DISCORD_TOKEN=your_token" > ~/.config/discord-notify/.env
echo '{"discord":{"userId":"YOUR_USER_ID"}}' > ~/.config/discord-notify/config.json
```

4. Start the daemon:

```bash
# Manual
discord-notify-daemon

# Or systemd (recommended)
cp systemd/discord-notify.service ~/.config/systemd/user/
systemctl --user enable --now discord-notify
```

## Usage

```bash
discord-notify --help
```

### Send notification

```bash
discord-notify send "Task completed"
```

### Ask question (blocks until response)

```bash
response=$(discord-notify ask "Continue?")
echo "User said: $response"
```

### Ask with buttons

```bash
choice=$(discord-notify ask "Pick one" --options "Option A,Option B,Option C")
```

### Non-blocking

```bash
discord-notify ask "Question?" --no-wait
```

## Part of [llm-cli](https://github.com/llm-cli)

LLM-first CLI tools optimized for AI agents.
