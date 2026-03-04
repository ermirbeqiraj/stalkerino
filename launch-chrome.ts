/**
 * launch-chrome.ts — Opens Chrome with --remote-debugging-port=9222 so that
 * `npm run login` can connect to it via CDP.
 *
 * Usage: npm run chrome
 * Then in another terminal: npm run login -- x
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { spawn } from "child_process";

const CONFIG_PATH = path.resolve(".project/config.yaml");
const PROFILE_DIR = path.resolve(".chrome-profile");

const config = yaml.load(fs.readFileSync(CONFIG_PATH, "utf-8")) as Record<string, unknown>;
const chromePath = config["chromePath"] as string;

if (!chromePath) {
  console.error("chromePath not set in .project/config.yaml");
  process.exit(1);
}

console.log(`[chrome] Launching Chrome with remote debugging on port 9222...`);
console.log(`[chrome] Profile: ${PROFILE_DIR}`);
console.log(`[chrome] Now run in another terminal: npm run login -- <adapter>`);

const child = spawn(chromePath, [
  "--remote-debugging-port=9222",
  `--user-data-dir=${PROFILE_DIR}`,
  "--no-first-run",
], {
  detached: true,
  stdio: "ignore",
});

child.unref();
