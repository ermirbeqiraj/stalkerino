# Stalkerino

A site monitoring bot that watches X (Twitter) profiles for new posts and sends Telegram notifications.

## How it works

- Connects to your local Chrome instance via CDP (no automation flags — Google/X see a real browser)
- Scrapes post IDs directly from the DOM (`/status/<id>` links) — no AI hallucination
- Deduplicates against local state, notifies only on new posts
- Runs on a cron schedule (default: every 5 minutes)

## Requirements

- Node.js 22+
- Google Chrome installed
- A Telegram bot + chat ID ([create one via @BotFather](https://t.me/BotFather))

## Setup

### 1. Install dependencies

```bash
npm install
npx playwright install chromium
```

### 2. Configure

```bash
cp .project/config.example.yaml .project/config.yaml
```

Edit `.project/config.yaml`:
- Set `chromePath` to your Chrome executable
- Set `notifications.telegram.token` and `chat_id`
- Add targets under `x-dom.targets`

### 3. Log in to X

Start Chrome with remote debugging enabled:

```bash
npm run chrome
```

In a separate terminal, run the login flow:

```bash
npm run login -- x
```

Log in to X manually in the Chrome window, then press Enter in the terminal.
Your session cookies are saved to `.sessions/x.json`.

### 4. Run

```bash
npm start
```

The bot runs immediately on startup, then on the configured cron schedule.

## Project structure

```
adapters/
  base.ts        — shared browser helpers (CDP login, page creation, Stagehand)
  x-dom.ts       — X adapter using DOM scraping (recommended)
  x.ts           — X adapter using AI extraction via Stagehand (disabled)
  reddit.ts      — Reddit adapter (not yet implemented)
runner.ts        — cron scheduler, config loading, state management
notify.ts        — Telegram notifications + local log
login.ts         — interactive login flow
launch-chrome.ts — launches Chrome with remote debugging port
.project/
  config.yaml         — your local config (gitignored)
  config.example.yaml — template
  state.json          — seen item IDs (gitignored)
  notifications.log   — local notification history (gitignored)
.sessions/       — saved browser sessions (gitignored)
```

## Adding targets

Edit `.project/config.yaml` and add handles under `x-dom.targets`:

```yaml
adapters:
  x-dom:
    enabled: true
    targets:
      - naval
      - base
      - CoinbaseDev
```

Restart `npm start` to pick up changes.
