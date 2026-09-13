import { getBotManager, type ActivityType } from "./bot-manager";
    import { getMusicManager } from "./music-manager";

    const ANSI = "\\u001b[";
    const FENCE = String.fromCharCode(96).repeat(3);
    const HELP_MESSAGE = [
    FENCE + "ansi",
    ANSI + "1;36m- xhelp [or xsetup]" + ANSI + "0m",
    ANSI + "1;32m- xstatus [online|idle|dnd|invisible|streaming]" + ANSI + "0m",
    ANSI + "1;33m- xactivity <type> <name> [artist] [album] [image-url] [twitch-id]" + ANSI + "0m",
    ANSI + "1;35m- xjoin vc <guild-id> <channel-id>" + ANSI + "0m",
    ANSI + "1;31m- xplay <youtube-url>" + ANSI + "0m",
    ANSI + "1;32m- xpause" + ANSI + "0m",
    ANSI + "1;33m- xstop" + ANSI + "0m",
    ANSI + "1;35m- xwhitelist list|add <user-id> <label>|remove <entry-id>" + ANSI + "0m",
    ANSI + "1;31m- xnickname <guild-id> <nickname>" + ANSI + "0m",
    ANSI + "1;32m- xaccounts" + ANSI + "0m",
    ANSI + "1;33m- xdisconnect" + ANSI + "0m",
    FENCE,
    ].join("\\n");

    const attachedClients = new WeakSet<object>();
    function send(message: any, content: string): Promise<unknown> { return message.channel.send(content); }
    function primaryManager() { return getBotManager("primary"); }

    async function handleCommand(message: any): Promise<void> {
    const primaryUserId = primaryManager().getState().userId;
    if (!primaryUserId || message.author?.id !== primaryUserId) return;
    const content = typeof message.content === "string" ? message.content.trim() : "";
    if (!content.toLowerCase().startsWith("x")) return;
    const parts = content.slice(1).trim().split(/\\s+/).filter(Boolean);
    const command = (parts.shift() ?? "").toLowerCase();
    const args = parts;
    const manager = primaryManager();

    if (command === "help" || command === "setup") { await send(message, HELP_MESSAGE); return; }
    if (command === "accounts") { const state = manager.getState(); await send(message, "Primary account: " + (state.connected ? "connected" : "disconnected") + "\\n" + (state.username ?? "Not connected")); return; }
    if (command === "status") {
      const requested = args[0]?.toLowerCase();
      if (!requested) { const state = manager.getState(); await send(message, "Primary status: " + state.status + "\\nActivity: " + state.activityType); return; }
      if (!["online", "idle", "dnd", "invisible", "streaming"].includes(requested)) { await send(message, "Usage: xstatus online|idle|dnd|invisible|streaming"); return; }
      const updated = await manager.setStatus(requested as "online" | "idle" | "dnd" | "invisible" | "streaming", null, requested === "streaming" ? args[1] ?? "Twitch" : undefined, requested === "streaming" ? args[2] ?? null : undefined);
      await send(message, "Primary status set to " + updated.status);
      return;
    }
    if (command === "activity") {
      const type = args.shift()?.toLowerCase() as ActivityType | undefined;
      if (!type || !["none", "spotify", "playing", "watching", "competing"].includes(type)) { await send(message, "Usage: xactivity none|spotify|playing|watching|competing <name> [artist] [album] [image-url] [twitch-id]"); return; }
      const updated = await manager.setActivity(type, args.shift() ?? null, args.shift() ?? null, args.shift() ?? null, args.shift() ?? null, args.shift() ?? null);
      await send(message, "Primary activity set to " + updated.activityType);
      return;
    }
    if (command === "join" && args.shift()?.toLowerCase() === "vc") {
      const guildId = args.shift(); const channelId = args.shift(); const client = manager.getClient();
      if (!guildId || !channelId || !client) { await send(message, "Usage: xjoin vc <guild-id> <channel-id>"); return; }
      const state = await getMusicManager("primary").join(client, guildId, channelId);
      await send(message, "Joined " + (state.channelName ?? channelId)); return;
    }
    if (command === "play") {
      const query = args.join(" "); if (!query) { await send(message, "Usage: xplay <youtube-url>"); return; }
      const state = await getMusicManager("primary").play(query); await send(message, "Playing " + (state.currentTrackTitle ?? query)); return;
    }
    if (command === "pause") { const state = getMusicManager("primary").pause(); await send(message, state.paused ? "Playback paused" : "Playback resumed"); return; }
    if (command === "stop") { getMusicManager("primary").stop(); await send(message, "Playback stopped"); return; }
    if (command === "whitelist") {
      const action = args.shift()?.toLowerCase();
      if (action === "list") { const entries = manager.getWhitelist(); await send(message, entries.length ? entries.map((entry) => entry.id + " " + entry.userId + " " + entry.label).join("\\n") : "Whitelist is empty"); return; }
      if (action === "add") { const userId = args.shift(); const label = args.join(" "); if (!userId || !label) { await send(message, "Usage: xwhitelist add <user-id> <label>"); return; } const entry = manager.addToWhitelist(userId, label); await send(message, "Whitelisted " + entry.label); return; }
      if (action === "remove") { const id = args.shift(); if (!id || !manager.removeFromWhitelist(id)) { await send(message, "Whitelist entry not found"); return; } await send(message, "Whitelist entry removed"); return; }
      await send(message, "Usage: xwhitelist list|add <user-id> <label>|remove <entry-id>"); return;
    }
    if (command === "nickname") {
      const guildId = args.shift(); const nickname = args.join(" "); const client = manager.getClient(); const guild = guildId && client?.guilds.cache.get(guildId);
      if (!guild || !nickname) { await send(message, "Usage: xnickname <guild-id> <nickname>"); return; }
      const member = guild.members.me; if (!member) throw new Error("Primary account is not in that guild");
      await member.setNickname(nickname); await send(message, "Primary nickname updated"); return;
    }
    if (command === "disconnect") { await manager.disconnect(); await send(message, "Primary account disconnected"); }
    }

    export function installSecondaryCommandListener(): void {
    const client = getBotManager("secondary").getClient() as any;
    if (!client || attachedClients.has(client)) return;
    attachedClients.add(client);
    client.on("messageCreate", (message: any) => {
      void handleCommand(message).catch(async (error) => {
        const detail = error instanceof Error ? error.message : "Command failed";
        try { await send(message, "Command failed: " + detail); } catch { /* ignore reply failures */ }
      });
    });
    }
    