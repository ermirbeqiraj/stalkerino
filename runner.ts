import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import cron from "node-cron";
import { z } from "zod";
import { configureTelegram, notifyItem, notifySessionError } from "./notify.ts";
import type { Adapter, Item } from "./adapters/base.ts";
import { BrowserManager, type BrowserMode } from "./adapters/browser-manager.ts";

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

const AdapterConfigSchema = z.object({
  enabled: z.boolean().default(false),
  browser: z.enum(["chrome", "stagehand"]).default("chrome"),
  targets: z.array(z.string()).default([]),
});

const ConfigSchema = z.object({
  schedule: z.string().default("*/15 * * * *"),
  chromePath: z.string({
    required_error:
      "chromePath is required in .project/config.yaml — set it to your system Chrome executable path.",
  }),
  headless: z.boolean().default(false),
  modelName: z.string().default("gpt-4o-mini"),
  modelApiKey: z.string({
    required_error: "modelApiKey is required in .project/config.yaml — set it to your OpenAI API key.",
  }),
  adapters: z.record(AdapterConfigSchema).default({}),
  notifications: z
    .object({
      telegram: z
        .object({
          token: z.string(),
          chat_id: z.string(),
        })
        .optional(),
    })
    .default({}),
});

type Config = z.infer<typeof ConfigSchema>;

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const CONFIG_PATH = path.resolve(".project/config.yaml");
const STATE_PATH = path.resolve(".project/state.json");

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

function loadConfig(): Config {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`Config file not found: ${CONFIG_PATH}`);
  }
  const raw = yaml.load(fs.readFileSync(CONFIG_PATH, "utf-8"));
  return ConfigSchema.parse(raw);
}

// ---------------------------------------------------------------------------
// State management
// ---------------------------------------------------------------------------

type State = Record<string, string>;

function loadState(): State {
  if (!fs.existsSync(STATE_PATH)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf-8"));
  } catch {
    console.warn("[runner] Could not parse state.json — starting fresh");
    return {};
  }
}

function saveState(state: State): void {
  // Keep only the last 5 seen IDs per adapter:target to prevent unbounded growth.
  // IDs are stored in insertion order, so we just keep the tail.
  const grouped: Record<string, string[]> = {};
  for (const key of Object.keys(state)) {
    // key format: "adapter:target:postId"
    const prefix = key.split(":").slice(0, 2).join(":");
    (grouped[prefix] ??= []).push(key);
  }
  const trimmed: State = {};
  for (const keys of Object.values(grouped)) {
    for (const k of keys.slice(-5)) {
      trimmed[k] = k;
    }
  }
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(trimmed, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Adapter loading
// ---------------------------------------------------------------------------

async function loadAdapter(id: string): Promise<Adapter | null> {
  const adapterPath = `./adapters/${id}.ts`;
  try {
    const mod = await import(adapterPath);
    const adapter: Adapter = mod.default;
    if (!adapter || typeof adapter.check !== "function") {
      console.error(`[runner] Adapter "${id}" does not export a valid default`);
      return null;
    }
    return adapter;
  } catch (err) {
    console.error(`[runner] Failed to load adapter "${id}":`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main run function
// ---------------------------------------------------------------------------

async function runAdapters(config: Config): Promise<void> {
  const state = loadState();
  const stateUpdates: State = { ...state };

  const enabledAdapters = Object.entries(config.adapters).filter(
    ([, cfg]) => cfg.enabled
  );

  if (enabledAdapters.length === 0) {
    console.log("[runner] No adapters enabled.");
    return;
  }

  const manager = new BrowserManager({
    chromePath: config.chromePath,
    headless: config.headless,
    modelName: config.modelName,
    modelApiKey: config.modelApiKey,
  });

  try {
    for (const [id, adapterConfig] of enabledAdapters) {
      console.log(`[runner] Running adapter: ${id} (browser: ${adapterConfig.browser})`);

      const adapter = await loadAdapter(id);
      if (!adapter) continue;

      try {
        const ctx = await manager.getContext(id, adapterConfig.browser as BrowserMode);
        const items: Item[] = await adapter.check(ctx, adapterConfig.targets);

        let newCount = 0;
        const notifiedTargets = new Set<string>();
        for (const item of items) {
          const alreadySeen = !!state[item.id];
          stateUpdates[item.id] = item.id;

          if (alreadySeen) continue;

          const target = (item.meta?.target as string | undefined) ?? id;

          // Only notify the latest (first) new post per target per cycle
          if (notifiedTargets.has(target)) {
            console.log(`[${id}] Skipping extra new post for @${target} (already notified latest)`);
            continue;
          }
          notifiedTargets.add(target);

          newCount++;
          console.log(`[${id}] New item: ${item.id}`);

          await notifyItem({ adapterId: id, target, content: item.content, url: item.url });
        }

        if (newCount === 0) {
          console.log(`[${id}] No new items.`);
        } else {
          console.log(`[${id}] Notified ${newCount} new item(s).`);
        }

        saveState(stateUpdates);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[${id}] Adapter error:`, message);

        const isSessionError =
          message.toLowerCase().includes("session") ||
          message.toLowerCase().includes("login") ||
          message.toLowerCase().includes("redirect");

        if (isSessionError) {
          await notifySessionError(id, message);
        }
      }
    }
  } finally {
    await manager.closeAll();
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const config = loadConfig();

  console.log(`[runner] Using Chrome: ${config.chromePath}`);
  console.log(`[runner] Using model: ${config.modelName}`);

  if (config.notifications.telegram) {
    const { token, chat_id } = config.notifications.telegram;
    configureTelegram(token, chat_id);
    console.log("[runner] Telegram notifications configured.");
  } else {
    console.warn("[runner] No Telegram config — notifications will be skipped.");
  }

  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  if (!fs.existsSync(STATE_PATH)) {
    fs.writeFileSync(STATE_PATH, "{}", "utf-8");
    console.log("[runner] Created empty state.json");
  }

  console.log(`[runner] Schedule: ${config.schedule}`);
  console.log("[runner] Running immediately on startup...");
  await runAdapters(config);

  cron.schedule(config.schedule, async () => {
    console.log(`[runner] Cron tick at ${new Date().toISOString()}`);
    try {
      await runAdapters(config);
    } catch (err) {
      console.error("[runner] Unexpected error in scheduled run:", err);
    }
  });

  console.log(`[runner] Scheduler active. Press Ctrl+C to exit.`);
}

main().catch((err) => {
  console.error("[runner] Fatal error:", err);
  process.exit(1);
});
