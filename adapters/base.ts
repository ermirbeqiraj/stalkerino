import { chromium, type Page } from "playwright";
import { Stagehand } from "@browserbasehq/stagehand";
import path from "path";
import fs from "fs";

export interface Item {
  id: string;
  content: string;
  url?: string;
  meta?: Record<string, unknown>;
}

export interface Adapter {
  id: string;
  check(page: Page, targets: string[]): Promise<Item[]>;
}

const SESSIONS_DIR = path.resolve(".sessions");
const PROFILE_DIR = path.resolve(".chrome-profile");

// Set once at startup by configureChrome() — required before any browser launch.
let chromeExecutablePath: string | null = null;
let stagehandModelName: string = "gpt-4o-mini";
let stagehandModelApiKey: string | null = null;

/**
 * Must be called at startup before any browser launch.
 * runner.ts and login.ts both call this after reading chromePath from config.yaml.
 * Throws immediately if the path is empty — no silent fallback to bundled Chromium.
 */
export function configureChrome(executablePath: string): void {
  if (!executablePath) {
    throw new Error(
      "chromePath is empty. Set it in .project/config.yaml to your system Chrome executable.\n" +
        "  Windows: C:\Program Files\Google\Chrome\Application\chrome.exe\n" +
        "  macOS:   /Applications/Google Chrome.app/Contents/MacOS/Google Chrome\n" +
        "  Linux:   /usr/bin/google-chrome"
    );
  }
  chromeExecutablePath = executablePath;
}

export function configureModel(modelName: string, apiKey: string): void {
  stagehandModelName = modelName;
  stagehandModelApiKey = apiKey;
}

function requireChromePath(): string {
  if (!chromeExecutablePath) {
    throw new Error(
      "Chrome executable path not configured. " +
        "Ensure configureChrome() is called at startup (reads chromePath from config.yaml)."
    );
  }
  return chromeExecutablePath;
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

/**
 * Connect to a Chrome instance running with --remote-debugging-port=9222
 * (started via `npm run chrome`) and save storageState after login.
 * Chrome was not launched by Playwright, so no automation flags are injected.
 */
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

/**
 * Create a Playwright Page using system Chrome with the saved session profile.
 * Returns null if the session file does not exist.
 */
export async function createPage(adapterId: string): Promise<Page | null> {
  const executablePath = requireChromePath();
  const sPath = sessionPath(adapterId);
  if (!fs.existsSync(sPath)) {
    console.error(`[${adapterId}] Session file not found: ${sPath}`);
    return null;
  }

  const browser = await chromium.launch({
    executablePath,
    headless: true,
  });

  const context = await browser.newContext({ storageState: sPath });
  const page = await context.newPage();
  return page;
}

/**
 * Create a Stagehand instance using system Chrome with a loaded session.
 * Returns null if the session file does not exist.
 */
export async function createStagehand(
  adapterId: string
): Promise<Stagehand | null> {
  const executablePath = requireChromePath();
  const sPath = sessionPath(adapterId);
  if (!fs.existsSync(sPath)) {
    console.error(`[${adapterId}] Session file not found: ${sPath}`);
    return null;
  }

  const stagehand = new Stagehand({
    env: "LOCAL",
    headless: true,
    verbose: 0,
    domSettleTimeoutMs: 3000,
    modelName: stagehandModelName as any,
    modelClientOptions: { apiKey: stagehandModelApiKey ?? undefined },
    localBrowserLaunchOptions: { executablePath } as any,
  });

  await stagehand.init();

  // Inject saved session cookies into the Chrome context
  const sessionData = JSON.parse(fs.readFileSync(sPath, "utf-8"));
  if (sessionData.cookies?.length) {
    await stagehand.context.addCookies(sessionData.cookies);
  }

  return stagehand;
}

/**
 * Detect common "session expired / not logged in" redirect patterns.
 */
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