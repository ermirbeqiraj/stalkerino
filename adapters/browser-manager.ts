import { chromium, type Browser, type Page } from "playwright";
import { Stagehand } from "@browserbasehq/stagehand";
import fs from "fs";
import path from "path";

const SESSIONS_DIR = path.resolve(".sessions");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BrowserMode = "chrome" | "stagehand";

/**
 * What an adapter receives when it's invoked.
 * chrome    → plain Playwright Page backed by the real Chrome binary.
 * stagehand → same Chrome binary, but wrapped in Stagehand for AI extraction.
 */
export type AdapterRunContext =
  | { mode: "chrome"; page: Page }
  | { mode: "stagehand"; stagehand: Stagehand; page: Page };

// ---------------------------------------------------------------------------
// BrowserManager
// ---------------------------------------------------------------------------

/**
 * Created once per run cycle by runner.ts.
 * Lazily spins up browser resources as adapters ask for them,
 * then tears everything down via closeAll() at the end of the cycle.
 *
 * - chrome: one shared Browser, one Context+Page per adapter (so each
 *   adapter gets its own storageState / cookie jar).
 * - stagehand: one Stagehand instance per adapter (Stagehand owns its
 *   own browser process internally).
 *
 * All instances use chromePath — never Playwright's bundled Chromium.
 */
export class BrowserManager {
  private chromePath: string;
  private headless: boolean;
  private modelName: string;
  private modelApiKey: string;

  private browser: Browser | null = null;
  private stagheands = new Map<string, Stagehand>();

  constructor(opts: { chromePath: string; headless: boolean; modelName: string; modelApiKey: string }) {
    this.chromePath = opts.chromePath;
    this.headless = opts.headless;
    this.modelName = opts.modelName;
    this.modelApiKey = opts.modelApiKey;
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private async ensureBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.launch({
        executablePath: this.chromePath,
        headless: this.headless,
      });
    }
    return this.browser;
  }

  // -------------------------------------------------------------------------
  // Public
  // -------------------------------------------------------------------------

  /**
   * Returns a ready AdapterRunContext for the given adapter and mode.
   * Reuses existing instances where possible.
   */
  async getContext(adapterId: string, mode: BrowserMode): Promise<AdapterRunContext> {
    if (mode === "chrome") {
      const browser = await this.ensureBrowser();
      const sPath = path.join(SESSIONS_DIR, `${adapterId}.json`);
      const context = await browser.newContext(
        fs.existsSync(sPath) ? { storageState: sPath } : {}
      );
      const page = await context.newPage();
      return { mode: "chrome", page };
    }

    // stagehand — one Stagehand per adapter id, lazily created
    let sh = this.stagheands.get(adapterId);
    if (!sh) {
      sh = new Stagehand({
        env: "LOCAL",
        headless: this.headless,
        verbose: 0,
        domSettleTimeoutMs: 3000,
        modelName: this.modelName as any,
        modelClientOptions: { apiKey: this.modelApiKey },
        localBrowserLaunchOptions: { executablePath: this.chromePath } as any,
      });
      await sh.init();

      const sPath = path.join(SESSIONS_DIR, `${adapterId}.json`);
      if (fs.existsSync(sPath)) {
        const sessionData = JSON.parse(fs.readFileSync(sPath, "utf-8"));
        if (sessionData.cookies?.length) {
          await sh.context.addCookies(sessionData.cookies);
        }
      }

      this.stagheands.set(adapterId, sh);
    }

    return { mode: "stagehand", stagehand: sh, page: sh.page };
  }

  /**
   * Shuts down all browser processes. Called by runner.ts after each run cycle.
   */
  async closeAll(): Promise<void> {
    for (const sh of this.stagheands.values()) {
      await sh.close().catch(() => {});
    }
    this.stagheands.clear();

    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
  }
}
