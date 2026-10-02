import { getBotManager } from "./bot-manager";
import { logger } from "./logger";

// Deletes every message the primary account ever sent in a server, no matter
// how old. Uses Discord's server search (finds 2yr+ old messages) and keeps
// going through disconnects, rate limits and restarts until nothing is left.

type PurgeState = "idle" | "running" | "waiting" | "done" | "stopped" | "error";

type PurgeJob = {
  guildId: string;
  guildName: string;
  state: PurgeState;
  total: number | null;
  deleted: number;
  skipped: number;
  failed: number;
  startedAt: string;
  lastDeletedAt: string | null;
  finishedAt: string | null;
  message: string;
};

const API = "https://discord.com/api/v9";
const DELETE_WORKERS = 4;
const jobs = new Map<string, PurgeJob>();
const runIds = new Map<string, number>();
const skippedIds = new Map<string, Set<string>>();
let restored = false;

const TABLE_SQL = "CREATE TABLE IF NOT EXISTS message_purge_jobs (guild_id TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())";

async function pool(): Promise<any | null> {
  if (!process.env.DATABASE_URL) return null;
  try {
    const { pool } = await import("@workspace/db");
    await pool.query(TABLE_SQL);
    return pool;
  } catch (err) {
    logger.warn({ err }, "Purge job storage unavailable");
    return null;
  }
}

async function save(job: PurgeJob): Promise<void> {
  const db = await pool();
  if (!db) return;
  await db.query(
    "INSERT INTO message_purge_jobs (guild_id, data, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (guild_id) DO UPDATE SET data = $2, updated_at = NOW()",
    [job.guildId, JSON.stringify(job)],
  ).catch(() => undefined);
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function saveSoon(job: PurgeJob): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; void save(job); }, 3000);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function isActive(guildId: string, runId: number): boolean {
  return runIds.get(guildId) === runId;
}

// Waits until the primary account is online again (auto reconnect).
async function waitForClient(job: PurgeJob, runId: number): Promise<{ token: string; userId: string } | null> {
  let reconnectTried = 0;
  while (isActive(job.guildId, runId)) {
    const manager = getBotManager("primary");
    const client = manager.getClient() as any;
    const userId = manager.getState().userId;
    if (client?.token && userId && manager.getState().connected) {
      if (job.state === "waiting") { job.state = "running"; job.message = "Reconnected, deleting"; }
      return { token: client.token, userId };
    }
    job.state = "waiting";
    job.message = "Primary account offline, waiting to reconnect";
    if (client?.token && reconnectTried < Date.now() - 60000) {
      reconnectTried = Date.now();
      void manager.connect(client.token).catch(() => undefined);
    }
    await sleep(5000);
  }
  return null;
}

async function discord(token: string, method: string, path: string): Promise<Response> {
  return fetch(API + path, { method, headers: { Authorization: token } });
}

async function retryAfter(res: Response): Promise<number> {
  const body = await res.json().catch(() => null) as { retry_after?: number } | null;
  return Math.min(Math.max((body?.retry_after ?? 1) * 1000, 300), 60000);
}

async function deleteOne(job: PurgeJob, runId: number, channelId: string, messageId: string): Promise<void> {
  for (let attempt = 0; attempt < 6 && isActive(job.guildId, runId); attempt += 1) {
    const auth = await waitForClient(job, runId);
    if (!auth) return;
    try {
      const res = await discord(auth.token, "DELETE", "/channels/" + channelId + "/messages/" + messageId);
      if (res.ok || res.status === 404) {
        job.deleted += 1;
        job.lastDeletedAt = new Date().toISOString();
        return;
      }
      if (res.status === 429) { await sleep(await retryAfter(res)); continue; }
      if (res.status === 403 || res.status === 400) {
        // System messages / archived threads / no access: cannot be deleted.
        skippedIds.get(job.guildId)?.add(messageId);
        job.skipped += 1;
        return;
      }
      await sleep(1000 * (attempt + 1));
    } catch {
      await sleep(2000 * (attempt + 1));
    }
  }
  job.failed += 1;
  skippedIds.get(job.guildId)?.add(messageId);
}

async function run(job: PurgeJob, runId: number): Promise<void> {
  skippedIds.set(job.guildId, skippedIds.get(job.guildId) ?? new Set());
  job.state = "running";
  job.message = "Searching messages";
  let emptyPasses = 0;

  while (isActive(job.guildId, runId)) {
    const auth = await waitForClient(job, runId);
    if (!auth) return;
    const skipped = skippedIds.get(job.guildId)!;
    let res: Response;
    try {
      res = await discord(
        auth.token,
        "GET",
        "/guilds/" + job.guildId + "/messages/search?author_id=" + auth.userId
          + "&include_nsfw=true&sort_by=timestamp&sort_order=asc&offset=" + Math.min(skipped.size, 9975),
      );
    } catch {
      job.message = "Network error, retrying";
      await sleep(5000);
      continue;
    }
    if (res.status === 202 || res.status === 429) {
      job.message = res.status === 202 ? "Discord is indexing the server, waiting" : "Rate limited, waiting";
      await sleep(await retryAfter(res));
      continue;
    }
    if (res.status === 403 || res.status === 404) {
      job.state = "error";
      job.message = "Can't search this server (not a member or no access)";
      job.finishedAt = new Date().toISOString();
      await save(job);
      return;
    }
    if (!res.ok) {
      job.message = "Search failed (" + res.status + "), retrying";
      await sleep(5000);
      continue;
    }

    const body = await res.json() as { total_results?: number; messages?: any[][] };
    const found = (body.messages ?? [])
      .map((group) => group.find((m) => m.hit) ?? group[0])
      .filter((m) => m?.id && m.author?.id === auth.userId && !skipped.has(m.id));
    job.total = job.deleted + Math.max(0, (body.total_results ?? 0) - skipped.size);

    if (!found.length) {
      // Search index can lag right after deletes; confirm twice before finishing.
      emptyPasses += 1;
      if (emptyPasses >= 3) {
        job.state = "done";
        job.total = job.deleted;
        job.message = "All messages deleted";
        job.finishedAt = new Date().toISOString();
        await save(job);
        return;
      }
      await sleep(5000);
      continue;
    }
    emptyPasses = 0;
    job.message = "Deleting messages";

    // Spread deletes across a few workers so multiple channels run at once.
    const queue = [...found];
    await Promise.all(Array.from({ length: DELETE_WORKERS }, async () => {
      while (queue.length && isActive(job.guildId, runId)) {
        const m = queue.shift()!;
        await deleteOne(job, runId, m.channel_id, m.id);
      }
    }));
    saveSoon(job);
  }
}

function start(job: PurgeJob): void {
  const runId = (runIds.get(job.guildId) ?? 0) + 1;
  runIds.set(job.guildId, runId);
  jobs.set(job.guildId, job);
  void save(job);
  void run(job, runId).catch((err) => {
    logger.error({ err }, "Message purge crashed, restarting");
    job.message = "Crashed, restarting";
    setTimeout(() => { if (isActive(job.guildId, runId)) start(job); }, 5000);
  });
}

export function startMessagePurge(guildId: string): PurgeJob {
  const id = guildId.trim();
  if (!/^\d{5,25}$/.test(id)) throw new Error("Invalid server ID");
  const client = getBotManager("primary").getClient() as any;
  if (!client?.token) throw new Error("Primary account is not connected");
  const guildName = client.guilds?.cache?.get?.(id)?.name ?? id;
  const existing = jobs.get(id);
  const job: PurgeJob = existing && existing.state !== "done"
    ? { ...existing, state: "running", finishedAt: null, message: "Resuming" }
    : { guildId: id, guildName, state: "running", total: null, deleted: 0, skipped: 0, failed: 0, startedAt: new Date().toISOString(), lastDeletedAt: null, finishedAt: null, message: "Starting" };
  start(job);
  return job;
}

export function stopMessagePurge(guildId?: string): void {
  for (const job of jobs.values()) {
    if (guildId && job.guildId !== guildId) continue;
    runIds.set(job.guildId, (runIds.get(job.guildId) ?? 0) + 1);
    if (job.state === "running" || job.state === "waiting") {
      job.state = "stopped";
      job.message = "Stopped";
      job.finishedAt = new Date().toISOString();
    }
    void save(job);
  }
}

export function clearFinishedPurges(): void {
  for (const [id, job] of jobs) {
    if (job.state === "done" || job.state === "stopped" || job.state === "error") {
      jobs.delete(id);
      void pool().then((db) => db?.query("DELETE FROM message_purge_jobs WHERE guild_id = $1", [id]));
    }
  }
}

export function getMessagePurgeStatus() {
  const list = [...jobs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return { active: list.some((j) => j.state === "running" || j.state === "waiting"), jobs: list };
}

// Called on boot: resumes jobs that were running before a restart.
export async function restoreMessagePurges(): Promise<void> {
  if (restored) return;
  restored = true;
  const db = await pool();
  if (!db) return;
  const result = await db.query("SELECT data FROM message_purge_jobs").catch(() => ({ rows: [] }));
  for (const row of result.rows as { data: PurgeJob }[]) {
    const job = row.data;
    jobs.set(job.guildId, job);
    if (job.state === "running" || job.state === "waiting") {
      job.message = "Resuming after restart";
      start(job);
    }
  }
}
