import fs from "fs";
import path from "path";

const LOG_PATH = path.resolve(".project/notifications.log");

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
  // Always append to log file regardless of Telegram config
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}]\n${message}\n${"─".repeat(60)}\n`;
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.appendFileSync(LOG_PATH, logEntry, "utf-8");

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
        disable_web_page_preview: false,
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

export function buildMessage(opts: NotifyOptions): string {
  const lines: string[] = [
    `📡 <b>Stalkerino</b>`,
    `Adapter: <code>${opts.adapterId}</code>`,
    `Target: <code>${opts.target}</code>`,
    ``,
    opts.content,
  ];

  if (opts.url) {
    lines.push(``, `🔗 <a href="${opts.url}">${opts.url}</a>`);
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
