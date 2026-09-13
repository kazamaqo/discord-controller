import { Client, type Presence } from "discord.js-selfbot-v13";
import { logger } from "./logger";
import { v4 as uuidv4 } from "uuid";

export type Status = "online" | "idle" | "dnd" | "invisible" | "streaming";
export type ActivityType = "none" | "spotify" | "playing" | "watching" | "competing";

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
  statusStreamTitle: string | null;
  statusTwitchId: string | null;
  activityType: ActivityType;
  activitySongTitle: string | null;
  activityArtist: string | null;
  activityAlbum: string | null;
  activityImageUrl: string | null;
  activityTwitchId: string | null;
}

export class BotManager {
  private client: Client | null = null;
  private presenceUpdate: Promise<void> = Promise.resolve();
  private state: BotState = {
    connected: false,
    username: null,
    discriminator: null,
    avatarUrl: null,
    userId: null,
    status: "online",
    customText: null,
    statusStreamTitle: null,
    statusTwitchId: null,
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
        void this.applyPresence().catch((err) => logger.warn({ err }, "Initial presence update failed"));
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

  async setStatus(
    status: Status,
    customText?: string | null,
    streamTitle?: string | null,
    twitchId?: string | null
  ): Promise<BotState> {
    this.state.status = status;
    this.state.customText = customText ?? null;
    if (streamTitle !== undefined) this.state.statusStreamTitle = streamTitle?.trim() || "Twitch";
    if (twitchId !== undefined) this.state.statusTwitchId = twitchId?.trim() || null;
    if (this.client?.isReady()) {
      await this.applyPresence();
    }
    return this.getState();
  }

  async setActivity(
    type: ActivityType,
    songTitle?: string | null,
    artist?: string | null,
    album?: string | null,
    imageUrl?: string | null,
    twitchId?: string | null
  ): Promise<BotState> {
    this.state.activityType = type;
    this.state.activitySongTitle = songTitle ?? null;
    this.state.activityArtist = artist ?? null;
    this.state.activityAlbum = album ?? null;
    this.state.activityImageUrl = imageUrl ?? null;
    this.state.activityTwitchId = twitchId ?? null;
    if (this.client?.isReady()) {
      await this.applyPresence();
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

  private applyPresence(): Promise<void> {
    const update = async (): Promise<void> => {
      if (!this.client?.isReady()) return;

      const activities: object[] = [];
      const atype = this.state.activityType;
      const isStreamingStatus = this.state.status === "streaming";

      if (isStreamingStatus) {
        const twitchId = this.state.statusTwitchId?.trim();
        const streamTitle = this.state.statusStreamTitle?.trim() || "Twitch";
        activities.push({
          name: streamTitle,
          type: 1, // STREAMING is a Discord status activity, not a regular activity option
          url: `https://twitch.tv/${twitchId ?? "discord"}`,
          details: "Live on Twitch",
          state: twitchId ? `twitch.tv/${twitchId}` : "Streaming now",
        });
      } else if (atype === "spotify") {
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
      } else if (atype === "competing") {
        activities.push({ name: this.state.activitySongTitle ?? "a tournament", type: 5 });
      } else if (this.state.customText) {
        activities.push({ name: this.state.customText, type: 4 });
      }

      await Promise.resolve(
        this.client.user!.setPresence({
          // Discord has no streaming status value; streaming is represented by type 1 while online.
          status: isStreamingStatus ? "online" : this.state.status,
          activities,
        } as any)
      );
    };

    // Serialize updates so rapid status changes cannot overwrite each other out of order.
    this.presenceUpdate = this.presenceUpdate.then(update, update);
    return this.presenceUpdate;
  }

}

export const ACCOUNT_IDS = ["primary", "secondary", "account3", "account4", "account5", "account6", "account7", "account8", "account9", "account10"] as const;
export type AccountId = (typeof ACCOUNT_IDS)[number];

const accountManagers = new Map<AccountId, BotManager>();

export function isAccountId(value: unknown): value is AccountId {
  return typeof value === "string" && (ACCOUNT_IDS as readonly string[]).includes(value);
}

export function accountIdFromValue(value: unknown): AccountId {
  return isAccountId(value) ? value : "primary";
}

export function getBotManager(accountId: AccountId = "primary"): BotManager {
  const existing = accountManagers.get(accountId);
  if (existing) return existing;
  const manager = new BotManager();
  accountManagers.set(accountId, manager);
  return manager;
}

export function getAccountSummaries(): { id: AccountId; label: string; state: BotState }[] {
  return ACCOUNT_IDS.map((id) => ({
    id,
    label: `Account ${ACCOUNT_IDS.indexOf(id) + 1}`,
    state: getBotManager(id).getState(),
  }));
}

export const botManager = getBotManager("primary");
