# Stalkerino

A site monitoring bot that watches X (Twitter) profiles for new posts and sends Telegram notifications.

## How it works

- Launches your real Chrome binary (`chromePath`) via Playwright — no bundled Chromium, no automation flags
- Scrapes post IDs directly from the DOM (`/status/<id>` links) — no AI hallucination
- Deduplicates against local state, notifies only on new posts
- Runs on a cron schedule (default: every 5 minutes)
- Each run cycle spins up Chrome, does its work, then closes it cleanly

## Requirements

- Node.js 22+
- Google Chrome installed
- A Telegram bot + chat ID ([create one via @BotFather](https://t.me/BotFather))

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure

```bash
cp .project/config.example.yaml .project/config.yaml
```

Edit `.project/config.yaml`:
- Set `chromePath` to your Chrome executable path
- Set `headless: false` (recommended) or `true`
- Set `notifications.telegram.token` and `chat_id`
- Add target handles under `x-dom.targets`

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
  browser-manager.ts — owns Chrome/Stagehand lifecycle per run cycle
  base.ts            — shared types and login helpers
  x-dom.ts           — X adapter using DOM scraping (recommended, browser: chrome)
  x.ts               — X adapter using AI extraction via Stagehand (browser: stagehand)
  reddit.ts          — Reddit adapter (browser: stagehand)
runner.ts        — cron scheduler, config loading, state management
notify.ts        — Telegram notifications + local log
login.ts         — interactive login flow (one-time setup per adapter)
launch-chrome.ts — launches Chrome with remote debugging port (used by login flow)
.project/
  config.yaml         — your local config (gitignored)
  config.example.yaml — template
  state.json          — seen item IDs (gitignored)
  notifications.log   — local notification history (gitignored)
.sessions/       — saved browser sessions (gitignored)
```

## Config reference

```yaml
chromePath: 'C:\Program Files\Google\Chrome\Application\chrome.exe'
headless: false        # false = visible window (avoids bot detection), true = headless
schedule: "*/5 * * * *"

adapters:
  x-dom:
    enabled: true
    browser: chrome    # chrome | stagehand
    targets:
      - naval
      - base
```

Restart `npm start` to pick up config changes.
