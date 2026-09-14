import { ACCOUNT_IDS, getAccountSummaries, getBotManager, type AccountId, type ActivityType } from "./bot-manager";
import { getMusicManager } from "./music-manager";

const ANSI = String.fromCharCode(27) + "[";
const FENCE = String.fromCharCode(96).repeat(3);
const NL = String.fromCharCode(10);
const HELP_MESSAGE = [
  FENCE + "ansi",
  ANSI + "1;36m- xhelp [or xsetup]" + ANSI + "0m",
  ANSI + "1;32m- xstatus [online|idle|dnd|invisible|streaming]" + ANSI + "0m",
  ANSI + "1;33m- xactivity <type> <name> [artist] [album] [image-url] [twitch-id]" + ANSI + "0m",
  ANSI + "1;35m- xjoin vc <guild-id> <channel-id> (all connected accounts)" + ANSI + "0m",
  ANSI + "1;31m- xplay <youtube-url> (all connected accounts)" + ANSI + "0m",
  ANSI + "1;32m- xpause (all connected accounts)" + ANSI + "0m",
  ANSI + "1;33m- xstop (all connected accounts)" + ANSI + "0m",
  ANSI + "1;35m- xwhitelist list|add <user-id> <label>|remove <entry-id>" + ANSI + "0m",
  ANSI + "1;31m- xnickname <guild-id> <nickname>" + ANSI + "0m",
  ANSI + "1;36m- xnick <nickname> (all connected accounts in this server)" + ANSI + "0m",
  ANSI + "1;36m- xlink <discord-invite-link>" + ANSI + "0m",
  ANSI + "1;36m- xautoreact|xar [all|count] @user <emoji-id>" + ANSI + "0m",
  ANSI + "1;36m- xautoreact off" + ANSI + "0m",
  ANSI + "1;32m- xaccounts" + ANSI + "0m",
  ANSI + "1;33m- xdisconnect" + ANSI + "0m",
  FENCE,
].join(NL);

export type AutoreactConfig = {
  targetUserId: string;
  targetLabel: string;
  emojiId: string;
  accountIds: AccountId[];
  channelId: string;
};

let autoreactConfig: AutoreactConfig | null = null;
const attachedCommandClients = new WeakSet<object>();
const attachedAutomationClients = new WeakSet<object>();
const handledCommandMessages = new Set<string>();

function send(message: any, content: string): Promise<unknown> {
  return message.channel.send(content);
}

function primaryManager() {
  return getBotManager("primary");
}

async function deleteControllerMessage(message: any): Promise<void> {
  const primaryClient = primaryManager().getClient() as any;
  const channelId = message.channel?.id;
  const messageId = message.id;
  if (!primaryClient || !channelId || !messageId) return;

  try {
    const channel = await primaryClient.channels.fetch(channelId);
    const controllerMessage = await channel?.messages?.fetch(messageId);
    if (controllerMessage?.author?.id === primaryManager().getState().userId) {
      await controllerMessage.delete();
    }
  } catch {
    // The controller may not have permission to delete in this channel.
  }
}

async function replyAndDelete(message: any, content: string): Promise<void> {
  await send(message, content);
  await deleteControllerMessage(message);
}

function mentionedUser(message: any, args: string[]): { id: string; label: string } | null {
  const mentioned = message.mentions?.users?.first?.();
  if (mentioned?.id) {
    return { id: mentioned.id, label: mentioned.tag ?? mentioned.username ?? mentioned.id };
  }

  const rawMention = args.find((arg) => /^<@!?\d+>$/.test(arg)) ?? "";
  const match = rawMention.match(/^<@!?(\d+)>$/);
  return match ? { id: match[1], label: rawMention } : null;
}

function validEmojiId(value: string): boolean {
  return /^\d{5,25}$/.test(value) || /^[\w~]+:\d{5,25}$/.test(value);
}

function normalizeEmojiId(value: string): string {
  const customEmoji = value.match(/^<a?:([\w~]+):(\d+)>$/);
  return customEmoji ? customEmoji[1] + ":" + customEmoji[2] : value;
}

async function handleAutoreactMessage(accountId: AccountId, message: any): Promise<void> {
  const config = autoreactConfig;
  if (!config || !config.accountIds.includes(accountId)) return;
  if (message.channel?.id !== config.channelId) return;
  if (message.author?.id !== config.targetUserId) return;
  if (!message.react) return;

  try {
    await message.react(config.emojiId);
  } catch {
    // A missing emoji, inaccessible message, or rate limit must not stop other accounts.
  }
}

function extractInviteCode(value: string): string | null {
  let normalized = value.trim();
  for (const prefix of ["https://", "http://"]) {
    if (normalized.toLowerCase().startsWith(prefix)) normalized = normalized.slice(prefix.length);
  }
  if (normalized.toLowerCase().startsWith("www.")) normalized = normalized.slice(4);
  const segments = normalized.split("/").filter(Boolean);
  const host = segments[0]?.toLowerCase();
  if (host === "discord.gg" && segments[1]) return segments[1].split("?")[0];
  if ((host === "discord.com" || host === "discordapp.com") && segments[1]?.toLowerCase() === "invite" && segments[2]) return segments[2].split("?")[0];
  return null;
}

function accountLabel(accountId: AccountId): string {
  return "Account " + (ACCOUNT_IDS.indexOf(accountId) + 1);
}

export function connectedAccountIds(): AccountId[] {
  return ACCOUNT_IDS.filter((accountId) => getBotManager(accountId).getState().connected);
}

export function getAutoreactStatus() {
  if (!autoreactConfig) return { active: false, targetUserId: null, targetLabel: null, emojiId: null, channelId: null, accountIds: [] as AccountId[] };
  return { active: true, ...autoreactConfig, accountIds: [...autoreactConfig.accountIds] };
}

export function startAutoreact(options: { targetUserId: string; targetLabel?: string; emojiId: string; channelId: string; accountCount?: number | "all" }) {
  const targetUserId = options.targetUserId.trim();
  const channelId = options.channelId.trim();
  const emojiId = normalizeEmojiId(options.emojiId.trim());
  const connected = connectedAccountIds();
  const requestedCount = options.accountCount === undefined || options.accountCount === "all" ? connected.length : Number(options.accountCount);

  if (!/^\d{5,25}$/.test(targetUserId) || !/^\d{5,25}$/.test(channelId) || !validEmojiId(emojiId)) {
    throw new Error("Invalid target, channel, or emoji");
  }
  if (!connected.length) throw new Error("No connected accounts are available");
  if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > ACCOUNT_IDS.length) {
    throw new Error("Invalid account count");
  }

  const accountIds = connected.slice(0, requestedCount);
  autoreactConfig = { targetUserId, targetLabel: options.targetLabel?.trim() || targetUserId, emojiId, accountIds, channelId };
  return getAutoreactStatus();
}

export function stopAutoreact(): void {
  autoreactConfig = null;
}

async function handleCommand(message: any): Promise<void> {
  const primaryUserId = primaryManager().getState().userId;
  if (!primaryUserId || message.author?.id !== primaryUserId) return;
  const content = typeof message.content === "string" ? message.content.trim() : "";
  if (!content.toLowerCase().startsWith("x")) return;
  const messageId = typeof message.id === "string" ? message.id : null;
  if (messageId) {
    if (handledCommandMessages.has(messageId)) return;
    handledCommandMessages.add(messageId);
    if (handledCommandMessages.size > 2000) {
      const oldest = handledCommandMessages.values().next().value;
      if (oldest) handledCommandMessages.delete(oldest);
    }
  }

  const parts = content.slice(1).trim().split(/\s+/).filter(Boolean);
  const command = (parts.shift() ?? "").toLowerCase();
  const args = parts;
  const manager = primaryManager();

  if (command === "help" || command === "setup") {
    await replyAndDelete(message, HELP_MESSAGE);
    return;
  }
  if (command === "accounts") {
    const lines = getAccountSummaries().map((account) => account.label + ": " + (account.state.connected ? "connected" : "disconnected") + (account.state.username ? " (" + account.state.username + ")" : ""));
    await replyAndDelete(message, lines.join(NL));
    return;
  }
  if (command === "status") {
    const requested = args[0]?.toLowerCase();
    if (!requested) {
      const lines = connectedAccountIds().map((accountId) => {
        const state = getBotManager(accountId).getState();
        return accountLabel(accountId) + ": " + state.status + NL + "Activity: " + state.activityType;
      });
      await replyAndDelete(message, lines.length ? lines.join(NL) : "No connected accounts are available");
      return;
    }
    if (!["online", "idle", "dnd", "invisible", "streaming"].includes(requested)) {
      await replyAndDelete(message, "Usage: xstatus online|idle|dnd|invisible|streaming");
      return;
    }
    const updated: string[] = [];
    const failed: string[] = [];
    for (const accountId of connectedAccountIds()) {
      try {
        const state = await getBotManager(accountId).setStatus(
          requested as "online" | "idle" | "dnd" | "invisible" | "streaming",
          null,
          requested === "streaming" ? args[1] ?? "Twitch" : undefined,
          requested === "streaming" ? args[2] ?? null : undefined,
        );
        updated.push(accountLabel(accountId) + " (" + state.status + ")");
      } catch (error: unknown) {
        failed.push(accountLabel(accountId) + " (" + (error instanceof Error ? error.message : "failed") + ")");
      }
    }
    await replyAndDelete(message, "Status updated: " + (updated.length ? updated.join(", ") : "none") + (failed.length ? NL + "Failed: " + failed.join(", ") : ""));
    return;
  }
  if (command === "activity") {
    const type = args.shift()?.toLowerCase() as ActivityType | undefined;
    if (!type || !["none", "spotify", "playing", "watching", "competing"].includes(type)) {
      await replyAndDelete(message, "Usage: xactivity none|spotify|playing|watching|competing <name> [artist] [album] [image-url] [twitch-id]");
      return;
    }
    const songTitle = args.shift() ?? null;
    const artist = args.shift() ?? null;
    const album = args.shift() ?? null;
    const imageUrl = args.shift() ?? null;
    const twitchId = args.shift() ?? null;
    const updated: string[] = [];
    const failed: string[] = [];
    for (const accountId of connectedAccountIds()) {
      try {
        const state = await getBotManager(accountId).setActivity(type, songTitle, artist, album, imageUrl, twitchId);
        updated.push(accountLabel(accountId) + " (" + state.activityType + ")");
      } catch (error: unknown) {
        failed.push(accountLabel(accountId) + " (" + (error instanceof Error ? error.message : "failed") + ")");
      }
    }
    await replyAndDelete(message, "Activity updated: " + (updated.length ? updated.join(", ") : "none") + (failed.length ? NL + "Failed: " + failed.join(", ") : ""));
    return;
  }
  if (command === "join" && args.shift()?.toLowerCase() === "vc") {
    const guildId = args.shift();
    const channelId = args.shift();
    if (!guildId || !channelId) {
      await replyAndDelete(message, "Usage: xjoin vc <guild-id> <channel-id>");
      return;
    }
    const joined: string[] = [];
    const failed: string[] = [];
    for (const accountId of connectedAccountIds()) {
      const client = getBotManager(accountId).getClient();
      if (!client) {
        failed.push(accountLabel(accountId) + " (client unavailable)");
        continue;
      }
      try {
        const state = await getMusicManager(accountId).join(client, guildId, channelId);
        joined.push(accountLabel(accountId) + " (" + (state.channelName ?? channelId) + ")");
      } catch (error: unknown) {
        failed.push(accountLabel(accountId) + " (" + (error instanceof Error ? error.message : "join failed") + ")");
      }
    }
    await replyAndDelete(message, "Joined: " + (joined.length ? joined.join(", ") : "none") + (failed.length ? NL + "Failed: " + failed.join(", ") : ""));
    return;
  }
  if (command === "play") {
    const query = args.join(" ");
    if (!query) {
      await replyAndDelete(message, "Usage: xplay <youtube-url>");
      return;
    }
    const playing: string[] = [];
    const failed: string[] = [];
    for (const accountId of connectedAccountIds()) {
      try {
        const state = await getMusicManager(accountId).play(query);
        playing.push(accountLabel(accountId) + " (" + (state.currentTrackTitle ?? query) + ")");
      } catch (error: unknown) {
        failed.push(accountLabel(accountId) + " (" + (error instanceof Error ? error.message : "play failed") + ")");
      }
    }
    await replyAndDelete(message, "Playing: " + (playing.length ? playing.join(", ") : "none") + (failed.length ? NL + "Failed: " + failed.join(", ") : ""));
    return;
  }
  if (command === "pause") {
    const states = connectedAccountIds().map((accountId) => getMusicManager(accountId).pause());
    await replyAndDelete(message, states.some((state) => state.paused) ? "Playback paused for connected accounts" : "Playback resumed for connected accounts");
    return;
  }
  if (command === "stop") {
    connectedAccountIds().forEach((accountId) => getMusicManager(accountId).stop());
    await replyAndDelete(message, "Playback stopped for connected accounts");
    return;
  }
  if (command === "whitelist") {
    const action = args.shift()?.toLowerCase();
    if (action === "list") {
      const entries = manager.getWhitelist();
      await replyAndDelete(message, entries.length ? entries.map((entry) => entry.id + " " + entry.userId + " " + entry.label).join(NL) : "Whitelist is empty");
      return;
    }
    if (action === "add") {
      const userId = args.shift();
      const label = args.join(" ");
      if (!userId || !label) {
        await replyAndDelete(message, "Usage: xwhitelist add <user-id> <label>");
        return;
      }
      const entry = manager.addToWhitelist(userId, label);
      await replyAndDelete(message, "Whitelisted " + entry.label);
      return;
    }
    if (action === "remove") {
      const id = args.shift();
      if (!id || !manager.removeFromWhitelist(id)) {
        await replyAndDelete(message, "Whitelist entry not found");
        return;
      }
      await replyAndDelete(message, "Whitelist entry removed");
      return;
    }
    await replyAndDelete(message, "Usage: xwhitelist list|add <user-id> <label>|remove <entry-id>");
    return;
  }
  if (command === "nick") {
    const nickname = args.join(" ").trim();
    const guildId = message.guild?.id ?? message.channel?.guild?.id;
    if (!guildId || !nickname) {
      await replyAndDelete(message, "Usage: xnick <nickname> (in a server channel)");
      return;
    }
    if (nickname.length > 32) {
      await replyAndDelete(message, "Nickname must be 32 characters or fewer");
      return;
    }

    const connectedAccountIds = ACCOUNT_IDS.filter((accountId) => getBotManager(accountId).getState().connected);
    if (!connectedAccountIds.length) {
      await replyAndDelete(message, "No connected accounts are available");
      return;
    }

    const updated: AccountId[] = [];
    const skipped: AccountId[] = [];
    const failed: string[] = [];
    for (const accountId of connectedAccountIds) {
      const client = getBotManager(accountId).getClient() as any;
      const guild = client?.guilds?.cache?.get(guildId);
      if (!guild) {
        skipped.push(accountId);
        continue;
      }

      try {
        const member = guild.members.me;
        if (!member) throw new Error("member unavailable");
        await member.setNickname(nickname);
        updated.push(accountId);
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : "nickname update failed";
        failed.push(accountLabel(accountId) + " (" + detail.slice(0, 120) + ")");
      }
    }

    const lines = [
      "xnick complete: " + nickname,
      "Updated: " + (updated.length ? updated.map(accountLabel).join(", ") : "none"),
      "Not in server: " + (skipped.length ? skipped.map(accountLabel).join(", ") : "none"),
      "Failed: " + (failed.length ? failed.join(", ") : "none"),
    ];
    await replyAndDelete(message, lines.join(NL));
    return;
  }
  if (command === "nickname") {
    const guildId = args.shift();
    const nickname = args.join(" ");
    const client = manager.getClient();
    const guild = guildId && client?.guilds.cache.get(guildId);
    if (!guild || !nickname) {
      await replyAndDelete(message, "Usage: xnickname <guild-id> <nickname>");
      return;
    }
    const member = guild.members.me;
    if (!member) throw new Error("Primary account is not in that guild");
    await member.setNickname(nickname);
    await replyAndDelete(message, "Primary nickname updated");
    return;
  }
  if (command === "link") {
    const inviteCode = extractInviteCode(args.join(" "));
    if (!inviteCode) {
      await replyAndDelete(message, "Usage: xlink <discord.gg or discord.com/invite link>");
      return;
    }

    const connectedAccountIds = ACCOUNT_IDS.filter((accountId) => getBotManager(accountId).getState().connected);
    if (!connectedAccountIds.length) {
      await replyAndDelete(message, "No connected accounts are available");
      return;
    }

    const joined: AccountId[] = [];
    const skipped: AccountId[] = [];
    const failed: string[] = [];
    for (const accountId of connectedAccountIds) {
      const client = getBotManager(accountId).getClient() as any;
      if (!client) {
        failed.push(accountLabel(accountId) + " (client unavailable)");
        continue;
      }

      try {
        const invite = await client.fetchInvite(inviteCode);
        const guildId = invite.guild?.id ?? invite.guild?.guildId;
        if (guildId && client.guilds.cache.has(guildId)) {
          skipped.push(accountId);
          continue;
        }

        if (typeof client.acceptInvite === "function") {
          await client.acceptInvite(inviteCode);
        } else if (typeof invite.accept === "function") {
          await invite.accept();
        } else {
          throw new Error("This Discord client cannot accept invites");
        }
        joined.push(accountId);
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : "invite rejected";
        failed.push(accountLabel(accountId) + " (" + detail.slice(0, 120) + ")");
      }
    }

    const lines = [
      "xlink complete for " + inviteCode,
      "Joined: " + (joined.length ? joined.map(accountLabel).join(", ") : "none"),
      "Already joined: " + (skipped.length ? skipped.map(accountLabel).join(", ") : "none"),
      "Failed: " + (failed.length ? failed.join(", ") : "none"),
    ];
    await replyAndDelete(message, lines.join(NL));
    return;
  }
  if (command === "autoreact" || command === "ar" || command === "react") {
    const action = args[0]?.toLowerCase();
    if (action === "off" || action === "stop" || action === "disable") {
      stopAutoreact();
      await replyAndDelete(message, "Autoreact stopped");
      return;
    }

    const target = mentionedUser(message, args);
    const emojiArg = args.find((value) => validEmojiId(normalizeEmojiId(value)));
    const emojiId = emojiArg ? normalizeEmojiId(emojiArg) : null;
    const countArg = args.find((value) => /^(?:all|every|[1-9]|10)$/i.test(value));
    if (!target || !emojiId) {
      await deleteControllerMessage(message);
      return;
    }

    try {
      const status = startAutoreact({
        targetUserId: target.id,
        targetLabel: target.label,
        emojiId,
        channelId: message.channel?.id ?? "",
        accountCount: !countArg || /^(?:all|every)$/i.test(countArg) ? "all" : Number(countArg),
      });
      await replyAndDelete(message, "Autoreact started for " + target.label + " using " + status.accountIds.length + " connected account(s)");
    } catch {
      await deleteControllerMessage(message);
    }
    return;
  }
  if (command === "disconnect") {
    await replyAndDelete(message, "Primary account disconnected");
    await manager.disconnect();
  }
}

export function installCommandListener(accountId: AccountId): void {
  const client = getBotManager(accountId).getClient() as any;
  if (!client || attachedCommandClients.has(client)) return;
  attachedCommandClients.add(client);
  client.on("messageCreate", (message: any) => {
    void handleCommand(message).catch(async (error) => {
      const detail = error instanceof Error ? error.message : "Command failed";
      try {
        await replyAndDelete(message, "Command failed: " + detail);
      } catch {
        // Ignore reply failures when the source channel is unavailable.
      }
    });
  });
}

export function installPrimaryCommandListener(): void {
  installCommandListener("primary");
}

export function installAccountAutomationListener(accountId: AccountId): void {
  const client = getBotManager(accountId).getClient() as any;
  if (!client || attachedAutomationClients.has(client)) return;
  attachedAutomationClients.add(client);
  client.on("messageCreate", (message: any) => {
    void handleAutoreactMessage(accountId, message).catch(() => undefined);
  });
}
