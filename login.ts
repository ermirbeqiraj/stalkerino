/**
 * login.ts — Interactive session setup for an adapter.
 *
 * Usage:
 *   npm run login -- x
 *   npm run login -- reddit
 *
 * Opens a visible browser window so you can log in manually.
 * When you're done, press Enter in the terminal to save the session.
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { loginBrowserCDP, configureChrome } from "./adapters/base.ts";

const SESSIONS_DIR = path.resolve(".sessions");
const CONFIG_PATH = path.resolve(".project/config.yaml");

function loadChromePath(): string {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`Config file not found: ${CONFIG_PATH}`);
  }
  const config = yaml.load(fs.readFileSync(CONFIG_PATH, "utf-8")) as Record<string, unknown>;
  const chromePath = config["chromePath"];
  if (!chromePath || typeof chromePath !== "string") {
    throw new Error(
      "chromePath is missing from .project/config.yaml.\n" +
        "Add it, e.g.:\n" +
        "  chromePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'"
    );
  }
  return chromePath;
}

async function main(): Promise<void> {
  const adapterId = process.argv[2];

  if (!adapterId) {
    console.error("Usage: npm run login -- <adapterId>");
    console.error("Example: npm run login -- x");
    process.exit(1);
  }

  const knownAdapters = ["x", "reddit"];
  if (!knownAdapters.includes(adapterId)) {
    console.warn(
      `[login] Warning: "${adapterId}" is not a known adapter (${knownAdapters.join(", ")}). Continuing anyway.`
    );
  }

  fs.mkdirSync(SESSIONS_DIR, { recursive: true });

  const chromePath = loadChromePath();
  configureChrome(chromePath);

  const startUrls: Record<string, string> = {
    x: "https://x.com/login",
    reddit: "https://www.reddit.com/login",
  };
  const startUrl = startUrls[adapterId];

  console.log(`[login] Connecting to Chrome at http://localhost:9222 ...`);
  console.log(`[login] Make sure Chrome is running via: npm run chrome`);

  await loginBrowserCDP(adapterId, startUrl);

  console.log(`\n[login] Done! Session saved.`);
  console.log(`[login] You can now run: npm start`);
}

main().catch((err) => {
  console.error("[login] Error:", err);
  process.exit(1);
});
