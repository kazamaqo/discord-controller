// Primary-account-only inbox: saves every message that @mentions the primary
// account or contains one of the watch words (default "jin"), so `xcheck`
// can show what was said while the owner was away.
const MAX_ENTRIES = 500;
const WATCH_WORDS = ["jin"];

export type MentionEntry = {
  id: string;
  at: number;
  guild: string;
  channel: string;
  author: string;
  content: string;
  link: string;
};

let entries: MentionEntry[] = [];
const seen = new Set<string>();

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function matchesWatch(content: string, mentionsMe: boolean): boolean {
  if (mentionsMe) return true;
  return WATCH_WORDS.some((word) => new RegExp("(^|[^a-z0-9])" + escapeRegex(word) + "($|[^a-z0-9])", "i").test(content));
}

export function recordMention(message: any, primaryUserId: string | null | undefined): void {
  if (!primaryUserId || !message?.id || seen.has(message.id)) return;
  if (message.author?.id === primaryUserId) return;
  const content: string = typeof message.content === "string" ? message.content : "";
  const mentionsMe = Boolean(message.mentions?.users?.has?.(primaryUserId)) || content.includes("<@" + primaryUserId + ">") || content.includes("<@!" + primaryUserId + ">");
  if (!matchesWatch(content, mentionsMe)) return;
  const guildId = message.guild?.id ?? "@me";
  seen.add(message.id);
  entries.push({
    id: message.id,
    at: Date.now(),
    guild: message.guild?.name ?? "DM",
    channel: message.channel?.name ? "#" + message.channel.name : "DM",
    author: message.author?.username ?? message.author?.id ?? "unknown",
    content: content || "(no text)",
    link: "https://discord.com/channels/" + guildId + "/" + (message.channel?.id ?? "") + "/" + message.id,
  });
  if (entries.length > MAX_ENTRIES) {
    const removed = entries.shift();
    if (removed) seen.delete(removed.id);
  }
}

export function clearMentions(): number {
  const count = entries.length;
  entries = [];
  seen.clear();
  return count;
}

// Plain-text chunks under Discord's 2000 character limit, oldest first.
export function mentionChunks(): string[] {
  if (!entries.length) return ["No new messages mentioning you."];
  const lines = entries.map((e) => {
    const time = new Date(e.at).toISOString().slice(5, 16).replace("T", " ");
    const text = e.content.replace(/@(everyone|here)/g, "@\u200b$1").slice(0, 1500);
    return time + " UTC | " + e.guild + " " + e.channel + " | " + e.author + ": " + text + " <" + e.link + ">";
  });
  const chunks: string[] = [];
  let current = entries.length + " messages:";
  for (const line of lines) {
    if (current.length + line.length + 1 > 1990) {
      chunks.push(current);
      current = line;
    } else {
      current += "\n" + line;
    }
  }
  chunks.push(current);
  return chunks;
}
