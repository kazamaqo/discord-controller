import { Client, type Presence } from "discord.js-selfbot-v13";
import { logger } from "./logger";
import { v4 as uuidv4 } from "uuid";

export type Status = "online" | "idle" | "dnd" | "invisible";
export type ActivityType = "none" | "spotify" | "playing" | "watching" | "streaming" | "competing";

export interface WhitelistEntry {
  id: string;
  userId: string;
  label: string;
  addedAt: string;
}

export interface BotState {
  connected: boolean;
  username: string | null;
  discriminator: string | null;
  avatarUrl: string | null;
  userId: string | null;
  status: Status;
  customText: string | null;
  activityType: ActivityType;
  activitySongTitle: string | null;
  activityArtist: string | null;
  activityAlbum: string | null;
  activityImageUrl: string | null;
  activityTwitchId: string | null;
}

class BotManager {
  private client: Client | null = null;
  private state: BotState = {
    connected: false,
    username: null,
    discriminator: null,
    avatarUrl: null,
    userId: null,
    status: "online",
    customText: null,
    activityType: "none",
    activitySongTitle: null,
    activityArtist: null,
    activityAlbum: null,
    activityImageUrl: null,
    activityTwitchId: null,
  };
  private whitelist: WhitelistEntry[] = [];

  getState(): BotState {
    return { ...this.state };
  }

  getWhitelist(): WhitelistEntry[] {
    return [...this.whitelist];
  }

  getClient(): Client | null {
    return this.client;
  }

  async connect(token: string): Promise<BotState> {
    if (this.client) {
      await this.disconnect();
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.client = new Client({ checkUpdate: false } as any);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Connection timed out"));
      }, 15000);

      this.client!.on("ready", () => {
        clearTimeout(timeout);
        const user = this.client!.user!;
        this.state = {
          ...this.state,
          connected: true,
          username: user.username,
          discriminator: user.discriminator,
          avatarUrl: user.displayAvatarURL(),
          userId: user.id,
        };
        logger.info({ userId: user.id, username: user.username }, "Bot connected");
        this.applyPresence();
        resolve(this.getState());
      });

      this.client!.on("error", (err) => {
        clearTimeout(timeout);
        logger.error({ err }, "Bot client error");
        this.state.connected = false;
        reject(err);
      });

      this.client!.login(token).catch((err) => {
        clearTimeout(timeout);
        logger.error({ err }, "Bot login failed");
        reject(err);
      });
    });
  }

  async disconnect(): Promise<BotState> {
    if (this.client) {
      try {
        await this.client.destroy();
      } catch (err) {
        logger.warn({ err }, "Error destroying client");
      }
      this.client = null;
    }
    this.state = {
      ...this.state,
      connected: false,
      username: null,
      discriminator: null,
      avatarUrl: null,
      userId: null,
    };
    return this.getState();
  }

  async setStatus(status: Status, customText?: string | null): Promise<BotState> {
    this.state.status = status;
    this.state.customText = customText ?? null;
    if (this.client?.isReady()) {
      this.applyPresence();
    }
    return this.getState();
  }

  setActivity(
    type: ActivityType,
    songTitle?: string | null,
    artist?: string | null,
    album?: string | null,
    imageUrl?: string | null,
    twitchId?: string | null
  ): BotState {
    this.state.activityType = type;
    this.state.activitySongTitle = songTitle ?? null;
    this.state.activityArtist = artist ?? null;
    this.state.activityAlbum = album ?? null;
    this.state.activityImageUrl = imageUrl ?? null;
    this.state.activityTwitchId = twitchId ?? null;
    if (this.client?.isReady()) {
      this.applyPresence();
    }
    return this.getState();
  }

  async massDm(message: string): Promise<{
    sent: number;
    failed: number;
    total: number;
    details: { userId: string; label: string; success: boolean; error: string | null }[];
  }> {
    const details: { userId: string; label: string; success: boolean; error: string | null }[] = [];

    for (const entry of this.whitelist) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const user = await (this.client as any)?.users.fetch(entry.userId);
        if (!user) throw new Error("User not found");
        const dm = await user.createDM();
        await dm.send(message);
        details.push({ userId: entry.userId, label: entry.label, success: true, error: null });
        await new Promise((r) => setTimeout(r, 1000));
      } catch (err: unknown) {
        const error = err instanceof Error ? err.message : "Unknown error";
        details.push({ userId: entry.userId, label: entry.label, success: false, error });
      }
    }

    const sent = details.filter((d) => d.success).length;
    return { sent, failed: details.length - sent, total: details.length, details };
  }

  addToWhitelist(userId: string, label: string): WhitelistEntry {
    const entry: WhitelistEntry = {
      id: uuidv4(),
      userId,
      label,
      addedAt: new Date().toISOString(),
    };
    this.whitelist.push(entry);
    return entry;
  }

  removeFromWhitelist(id: string): boolean {
    const before = this.whitelist.length;
    this.whitelist = this.whitelist.filter((e) => e.id !== id);
    return this.whitelist.length < before;
  }

  private applyPresence(): void {
    if (!this.client?.isReady()) return;

    const activities: object[] = [];
    const atype = this.state.activityType;

    if (atype === "spotify") {
      const now = Date.now();
      const trackDuration = 210000; // 3:30 default
      activities.push({
        name: "Spotify",
        type: 2, // LISTENING
        details: this.state.activitySongTitle ?? "Unknown Track",
        state: this.state.activityArtist ?? "Unknown Artist",
        assets: {
          large_image: this.state.activityImageUrl ?? "spotify:ab67616d0000b273",
          large_text: this.state.activityAlbum ?? "Unknown Album",
          small_image: "spotify:ab6775700000ee85d",
          small_text: "Spotify",
        },
        timestamps: {
          start: now - 30000,
          end: now + trackDuration,
        },
        party: { id: `spotify:${this.state.userId ?? "user"}` },
        sync_id: `spotify_track_${now}`,
        flags: 48,
      });
    } else if (atype === "playing") {
      activities.push({ name: this.state.activitySongTitle ?? "a game", type: 0 });
    } else if (atype === "watching") {
      activities.push({ name: this.state.activitySongTitle ?? "something", type: 3 });
    } else if (atype === "streaming") {
      activities.push({
        name: this.state.activitySongTitle ?? "stream",
        type: 1,
        url: `https://twitch.tv/${this.state.activityTwitchId ?? "discord"}`,
      });
    } else if (atype === "competing") {
      activities.push({ name: this.state.activitySongTitle ?? "a tournament", type: 5 });
    } else if (this.state.customText) {
      activities.push({ name: this.state.customText, type: 4 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.client.user!.setPresence({
      status: this.state.status,
      activities,
    } as any);
  }

}

export const botManager = new BotManager();
