export type State = Record<string, string>;

export interface StateStore {
  load(): Promise<State>;
  save(state: State): Promise<void>;
}

const TWITTER_EPOCH = 1288834974657n;
const PRUNE_AGE_MS = 48 * 60 * 60 * 1000;

function pruneState(state: State): State {
  const cutoff = Date.now() - PRUNE_AGE_MS;
  const pruned: State = {};

  for (const [key, val] of Object.entries(state)) {
    const postId = key.split(":").at(-1) ?? "";
    try {
      const postMs = Number((BigInt(postId) >> 22n) + TWITTER_EPOCH);
      if (postMs >= cutoff) {
        pruned[key] = val;
      }
    } catch {
      pruned[key] = val;
    }
  }

  return pruned;
}

export class FirebaseStateStore implements StateStore {
  private readonly url: string;
  private readonly secret: string;

  constructor(firebaseUrl: string, firebaseSecret: string) {
    const base = firebaseUrl.replace(/\/$/, "");
    this.url = `${base}/stalkerino/state.json`;
    this.secret = firebaseSecret;
  }

  async load(): Promise<State> {
    const res = await fetch(`${this.url}?auth=${this.secret}`);

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`[state-store] Firebase load failed (${res.status}): ${body}`);
    }

    const data = await res.json();

    if (data === null) {
      console.log("[state-store] No existing state in Firebase — starting fresh.");
      return {};
    }

    if (typeof data !== "object" || Array.isArray(data)) {
      throw new Error(`[state-store] Unexpected state shape from Firebase: ${JSON.stringify(data)}`);
    }

    return data as State;
  }

  async save(state: State): Promise<void> {
    const pruned = pruneState(state);

    const res = await fetch(`${this.url}?auth=${this.secret}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pruned),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`[state-store] Firebase save failed (${res.status}): ${body}`);
    }
  }
}
