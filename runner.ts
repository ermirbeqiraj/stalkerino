import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import cron from "node-cron";
import { z } from "zod";
import { configureTelegram, notifyItem, notifySessionError } from "./notify.ts";
import type { Adapter, Item } from "./adapters/base.ts";
import { BrowserManager, type BrowserMode } from "./adapters/browser-manager.ts";
import { FirebaseStateStore, type StateStore, type State } from "./state-store.ts";

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
  firebaseUrl: z.string({
    required_error: "firebaseUrl is required in .project/config.yaml — set it to your Firebase Realtime DB URL.",
  }),
  firebaseSecret: z.string({
    required_error: "firebaseSecret is required in .project/config.yaml — set it to your Firebase database secret.",
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

async function runAdapters(config: Config, store: StateStore): Promise<void> {
  const state = await store.load();
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

        await store.save(stateUpdates);
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

  const store = new FirebaseStateStore(config.firebaseUrl, config.firebaseSecret);
  console.log(`[runner] State store: Firebase (${config.firebaseUrl})`);

  console.log(`[runner] Schedule: ${config.schedule}`);
  console.log("[runner] Running immediately on startup...");
  await runAdapters(config, store);

  cron.schedule(config.schedule, async () => {
    console.log(`[runner] Cron tick at ${new Date().toISOString()}`);
    try {
      await runAdapters(config, store);
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
