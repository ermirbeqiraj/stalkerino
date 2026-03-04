import fs from "fs";
import path from "path";

const LOG_PATH = path.resolve(".project/notifications.log");
const LOG_MAX_BYTES = 500 * 1024;

function appendToLog(entry: string): void {
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });

  if (fs.existsSync(LOG_PATH)) {
    const size = fs.statSync(LOG_PATH).size;
    if (size > LOG_MAX_BYTES) {
      const content = fs.readFileSync(LOG_PATH, "utf-8");
      fs.writeFileSync(LOG_PATH, content.slice(Math.floor(content.length / 2)), "utf-8");
    }
  }

  fs.appendFileSync(LOG_PATH, entry, "utf-8");
}

export interface NotifyOptions {
  adapterId: string;
  target: string;
  content: string;
  url?: string;
}

let telegramToken: string | undefined;
let telegramChatId: string | undefined;

export function configureTelegram(token: string, chatId: string): void {
  telegramToken = token;
  telegramChatId = chatId;
}

export async function notify(message: string): Promise<void> {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}]\n${message}\n${"─".repeat(60)}\n`;
  appendToLog(logEntry);

  if (!telegramToken || !telegramChatId) {
    console.warn("[notify] Telegram not configured — skipping notification");
    return;
  }

  const url = `https://api.telegram.org/bot${telegramToken}/sendMessage`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: telegramChatId,
        text: message,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`[notify] Telegram API error ${response.status}: ${body}`);
    }
  } catch (err) {
    console.error("[notify] Failed to send Telegram message:", err);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function buildMessage(opts: NotifyOptions): string {
  const lines: string[] = [
    `📡 <b>@${escapeHtml(opts.target)}</b>`,
    ``,
    escapeHtml(opts.content),
  ];

  if (opts.url) {
    lines.push(``, opts.url);
  }

  return lines.join("\n");
}

export async function notifyItem(opts: NotifyOptions): Promise<void> {
  const message = buildMessage(opts);
  await notify(message);
}

export async function notifySessionError(
  adapterId: string,
  detail: string
): Promise<void> {
  const message = [
    `⚠️ <b>Stalkerino — Session Error</b>`,
    `Adapter: <code>${adapterId}</code>`,
    ``,
    detail,
    ``,
    `Run <code>npm run login -- ${adapterId}</code> to re-authenticate.`,
  ].join("\n");

  await notify(message);
}
