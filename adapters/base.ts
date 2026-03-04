import { chromium } from "playwright";
import path from "path";
import fs from "fs";
import type { AdapterRunContext } from "./browser-manager.ts";

export interface Item {
  id: string;
  content: string;
  url?: string;
  meta?: Record<string, unknown>;
}

export interface Adapter {
  id: string;
  check(ctx: AdapterRunContext, targets: string[]): Promise<Item[]>;
}

const SESSIONS_DIR = path.resolve(".sessions");

let chromeExecutablePath: string | null = null;

export function configureChrome(executablePath: string): void {
  if (!executablePath) {
    throw new Error(
      "chromePath is empty. Set it in .project/config.yaml to your system Chrome executable."
    );
  }
  chromeExecutablePath = executablePath;
}

export function sessionPath(adapterId: string): string {
  return path.join(SESSIONS_DIR, `${adapterId}.json`);
}

export function sessionExists(adapterId: string): boolean {
  return fs.existsSync(sessionPath(adapterId));
}

const LOGIN_URLS: Record<string, string> = {
  x: "https://x.com/login",
  reddit: "https://www.reddit.com/login",
};

export async function loginBrowserCDP(
  adapterId: string,
  startUrl?: string,
  cdpUrl = "http://localhost:9222"
): Promise<void> {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });

  console.log(`[login] Connecting to Chrome at ${cdpUrl} …`);
  let browser;
  try {
    browser = await chromium.connectOverCDP(cdpUrl);
  } catch {
    throw new Error(
      `Could not connect to Chrome at ${cdpUrl}.\n` +
        `Make sure you ran 'npm run chrome' first.`
    );
  }

  const contexts = browser.contexts();
  const context = contexts[0] ?? (await browser.newContext());
  const pages = context.pages();
  const page = pages[0] ?? (await context.newPage());

  const url = startUrl ?? LOGIN_URLS[adapterId];
  if (url) {
    await page.goto(url);
  }

  console.log(`[login] Chrome connected. Log in manually, then press Enter here.`);
  await new Promise<void>((resolve) => {
    process.stdin.once("data", () => resolve());
  });

  const state = await context.storageState();
  fs.writeFileSync(sessionPath(adapterId), JSON.stringify(state, null, 2), "utf-8");
  console.log(`[login] Session saved to ${sessionPath(adapterId)}`);
  await browser.close();
}

export function isLoginPage(url: string): boolean {
  const loginPatterns = [
    /login/i,
    /signin/i,
    /auth\//i,
    /accounts\./i,
    /\/i\/flow\/login/i,
  ];
  return loginPatterns.some((p) => p.test(url));
}