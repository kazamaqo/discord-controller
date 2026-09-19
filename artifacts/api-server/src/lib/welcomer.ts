import { getBotManager } from "./bot-manager";
import { logger } from "./logger";

// Auto welcomer for the PRIMARY account only.
//
// A welcome bot (Mimu and friends) posts a message such as
// "welcome, <@1406356035836448778>" whenever someone joins. Self-bots do not
// reliably receive guildMemberAdd, so the new member's id is copied straight
// out of that bot message and used in a randomly picked reply.

export const DEFAULT_WELCOME_TEMPLATES = [
  "yo welcome {user} glad u joined, enjoy ur stay here",
  "welcome {user} hope u enjoy the server",
  "yo {user} welcome in, make urself comfortable",
  "welcome to the server {user} have fun",
  "yo welcome {user} enjoy ur stay",
  "welcome {user} glad to have u here",
  "ayoo welcome {user} hope u like it here",
  "welcome in {user} feel free to chill",
  "yo {user} welcome to the server, have fun",
  "welcome {user} enjoy ur time here",
];

export type WelcomerConfig = {
  enabled: boolean;
  channelId: string;
  /** Optional: only react to these author ids (the welcome bot). Empty = any bot/user but the primary itself. */
  watchUserIds: string[];
  /** Delay before replying, so it does not look instant. */
  delayMs: number;
  templates: string[];
};

type WelcomerStats = {
  welcomed: number;
  failed: number;
  lastUserId: string | null;
  lastMessage: string | null;
  lastWelcomedAt: string | null;
  lastError: string | null;
};

let config: WelcomerConfig = {
  enabled: false,
  channelId: "",
  watchUserIds: [],
  delayMs: 1500,
  templates: [...DEFAULT_WELCOME_TEMPLATES],
};

let stats: WelcomerStats = createStats();
const handledMessageIds = new Set<string>();
const recentlyWelcomed = new Map<string, number>();

function createStats(): WelcomerStats {
  return {
    welcomed: 0,
    failed: 0,
    lastUserId: null,
    lastMessage: null,
    lastWelcomedAt: null,
    lastError: null,
  };
}

function boundedAdd(set: Set<string>, value: string, maxSize: number): void {
  set.add(value);
  if (set.size <= maxSize) return;
  const oldest = set.values().next().value;
  if (oldest) set.delete(oldest);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getWelcomerStatus() {
  return {
    ...config,
    watchUserIds: [...config.watchUserIds],
    templates: [...config.templates],
    stats: { ...stats },
    defaultTemplates: [...DEFAULT_WELCOME_TEMPLATES],
  };
}

export function setWelcomerConfig(input: {
  enabled?: unknown;
  channelId?: unknown;
  watchUserIds?: unknown;
  delayMs?: unknown;
  templates?: unknown;
}) {
  const next: WelcomerConfig = { ...config };

  if (input.channelId !== undefined) {
    const channelId = String(input.channelId ?? "").trim();
    if (channelId && !/^\d{5,25}$/.test(channelId)) throw new Error("Invalid channel ID");
    next.channelId = channelId;
  }

  if (input.watchUserIds !== undefined) {
    const raw = Array.isArray(input.watchUserIds)
      ? input.watchUserIds
      : String(input.watchUserIds ?? "").split(/[\s,]+/);
    const ids = raw
      .map((value) => String(value).trim().replace(/^<@!?(\d+)>$/, "$1"))
      .filter(Boolean);
    if (ids.some((id) => !/^\d{5,25}$/.test(id))) throw new Error("Invalid watched bot ID");
    next.watchUserIds = ids;
  }

  if (input.delayMs !== undefined) {
    const delay = Number(input.delayMs);
    if (!Number.isFinite(delay) || delay < 0 || delay > 60000) throw new Error("Delay must be 0-60000 ms");
    next.delayMs = Math.round(delay);
  }

  if (input.templates !== undefined) {
    const raw = Array.isArray(input.templates) ? input.templates : String(input.templates ?? "").split(/\r?\n/);
    const templates = raw.map((value) => String(value).trim()).filter(Boolean);
    if (!templates.length) throw new Error("At least one welcome message is required");
    if (templates.some((value) => value.length > 500)) throw new Error("Welcome messages must be 500 characters or fewer");
    next.templates = templates;
  }

  if (input.enabled !== undefined) {
    next.enabled = input.enabled === true || input.enabled === "true";
  }

  if (next.enabled && !next.channelId) throw new Error("A welcome channel ID is required");

  config = next;
  return getWelcomerStatus();
}

export function resetWelcomerStats(): void {
  stats = createStats();
}

/** Pull the first user mention out of the message content or any embed. */
function extractMentionedUserId(message: any): string | null {
  const texts: string[] = [];
  if (typeof message?.content === "string") texts.push(message.content);
  for (const embed of (message?.embeds ?? []) as any[]) {
    for (const value of [embed?.description, embed?.title, embed?.author?.name, embed?.footer?.text]) {
      if (typeof value === "string") texts.push(value);
    }
    for (const field of (embed?.fields ?? []) as any[]) {
      if (typeof field?.name === "string") texts.push(field.name);
      if (typeof field?.value === "string") texts.push(field.value);
    }
  }

  for (const text of texts) {
    const match = text.match(/<@!?(\d{5,25})>/);
    if (match) return match[1];
  }

  const mentioned = message?.mentions?.users?.first?.();
  return typeof mentioned?.id === "string" ? mentioned.id : null;
}

function pickTemplate(): string {
  const templates = config.templates.length ? config.templates : DEFAULT_WELCOME_TEMPLATES;
  return templates[Math.floor(Math.random() * templates.length)];
}

function renderTemplate(template: string, userId: string): string {
  const mention = "<@" + userId + ">";
  return template
    .replace(/\{user\}/gi, mention)
    .replace(/\{mention\}/gi, mention)
    .replace(/<@user>/gi, mention);
}

export async function handleWelcomeMessage(message: any): Promise<void> {
  if (!config.enabled || !config.channelId) return;
  if (message?.channel?.id !== config.channelId) return;

  const primaryUserId = getBotManager("primary").getState().userId;
  const authorId = message?.author?.id;
  if (!primaryUserId || !authorId || authorId === primaryUserId) return;
  if (config.watchUserIds.length && !config.watchUserIds.includes(authorId)) return;

  const messageId = typeof message?.id === "string" ? message.id : null;
  if (!messageId || handledMessageIds.has(messageId)) return;

  const userId = extractMentionedUserId(message);
  if (!userId || userId === primaryUserId) return;

  // Welcome bots often post a plain line plus an embed for the same member.
  const lastAt = recentlyWelcomed.get(userId) ?? 0;
  if (Date.now() - lastAt < 60000) return;

  boundedAdd(handledMessageIds, messageId, 2000);
  recentlyWelcomed.set(userId, Date.now());
  if (recentlyWelcomed.size > 500) {
    const oldest = recentlyWelcomed.keys().next().value;
    if (oldest) recentlyWelcomed.delete(oldest);
  }

  const content = renderTemplate(pickTemplate(), userId);
  try {
    if (config.delayMs > 0) await sleep(config.delayMs);
    await message.channel.send(content);
    stats.welcomed += 1;
    stats.lastUserId = userId;
    stats.lastMessage = content;
    stats.lastWelcomedAt = new Date().toISOString();
    stats.lastError = null;
  } catch (error: unknown) {
    recentlyWelcomed.delete(userId);
    stats.failed += 1;
    stats.lastError = (error instanceof Error ? error.message : "Could not send the welcome message").slice(0, 160);
    logger.warn({ err: error, userId }, "Welcome message failed");
  }
}
