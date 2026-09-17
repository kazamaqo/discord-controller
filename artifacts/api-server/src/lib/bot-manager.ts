import { Client, RichPresence, CustomStatus, type Presence } from "discord.js-selfbot-v13";
import { logger } from "./logger";
import { v4 as uuidv4 } from "uuid";

export type Status = "online" | "idle" | "dnd" | "invisible" | "streaming";
export type ActivityType = "none" | "spotify" | "playing" | "watching" | "competing";

// Other users only see the purple "streaming" presence when the URL is a valid
// twitch.tv channel link, so normalise whatever the dashboard sent us.
// Any real Discord application id works for uploading external presence images
// (Discord proxies them and hands back an mp:external/... path).
const PRESENCE_APP_ID = process.env["DISCORD_APPLICATION_ID"] ?? "367827983903490050";

// Discord drops a self-bot's presence whenever the gateway resumes or another
// session (phone/desktop) takes over, which is why other people stop seeing the
// stream. Re-broadcast the presence on a timer to keep it live for everyone.
const PRESENCE_REFRESH_MS = Math.max(15000, Number(process.env["PRESENCE_REFRESH_MS"] ?? 30000));

function twitchUrl(raw: string | null | undefined): string {
  const cleaned = (raw ?? "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^(www\.)?twitch\.tv\//i, "")
    .replace(/[/?#].*$/, "")
    .toLowerCase();
  const channel = /^[a-z0-9_]{3,25}$/.test(cleaned) ? cleaned : "discord";
  return `https://www.twitch.tv/${channel}`;
}


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
  statusImageUrl: string | null;
  activityType: ActivityType;
  activitySongTitle: string | null;
  activityArtist: string | null;
  activityAlbum: string | null;
  activityImageUrl: string | null;
}

export class BotManager {
  private client: Client | null = null;
  private presenceUpdate: Promise<void> = Promise.resolve();
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
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
    statusImageUrl: null,
    activityType: "none",
    activitySongTitle: null,
    activityArtist: null,
    activityAlbum: null,
    activityImageUrl: null,
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
        void this.ensureActivityVisibility()
          .then(() => this.applyPresence())
          .catch((err) => logger.warn({ err }, "Initial presence update failed"));
        this.startPresenceRefresh();
        resolve(this.getState());
      });

      // A resumed gateway session starts with an empty presence.
      const reapply = (): void => {
        void this.applyPresence().catch((err) => logger.warn({ err }, "Presence re-apply failed"));
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.client as any).on("resumed", reapply);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.client as any).on("shardResume", reapply);

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

  private startPresenceRefresh(): void {
    this.stopPresenceRefresh();
    this.refreshTimer = setInterval(() => {
      if (!this.client?.isReady()) return;
      void this.applyPresence().catch((err) => logger.warn({ err }, "Presence refresh failed"));
    }, PRESENCE_REFRESH_MS);
    // Never hold the process open just for the refresh loop.
    (this.refreshTimer as unknown as { unref?: () => void }).unref?.();
  }

  private stopPresenceRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private async ensureActivityVisibility(): Promise<void> {
    if (!this.client?.isReady()) return;
    // Discord accepts the gateway update locally even when this account-level
    // privacy switch is off, but suppresses the activity for every other user.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const settings = (this.client as any).settings;
    if (settings?.activityDisplay !== true) {
      await settings.edit({ show_current_game: true });
      logger.info("Enabled Discord activity visibility for other users");
    }
  }

  async disconnect(): Promise<BotState> {
    this.stopPresenceRefresh();
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
    twitchId?: string | null,
    imageUrl?: string | null
  ): Promise<BotState> {
    this.state.status = status;
    this.state.customText = customText ?? null;
    if (streamTitle !== undefined) this.state.statusStreamTitle = streamTitle?.trim() || "Twitch";
    if (twitchId !== undefined) this.state.statusTwitchId = twitchId?.trim() || null;
    if (imageUrl !== undefined) this.state.statusImageUrl = imageUrl?.trim() || null;
    if (this.client?.isReady()) {
      await this.ensureActivityVisibility();
      await this.applyPresence();
    }
    return this.getState();
  }

  async setActivity(
    type: ActivityType,
    songTitle?: string | null,
    artist?: string | null,
    album?: string | null,
    imageUrl?: string | null
  ): Promise<BotState> {
    this.state.activityType = type;
    this.state.activitySongTitle = songTitle ?? null;
    this.state.activityArtist = artist ?? null;
    this.state.activityAlbum = album ?? null;
    this.state.activityImageUrl = imageUrl ?? null;
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

  // Discord only renders images it can fetch itself. Plain http(s) links are
  // uploaded once via the external-assets endpoint and cached as mp:external/...
  private externalImages = new Map<string, string>();

  private async resolveImage(raw: string | null | undefined): Promise<string | null> {
    const value = (raw ?? "").trim();
    if (!value) return null;
    if (/^(mp:|spotify:|twitch:|youtube:)/.test(value)) return value;
    if (/^[0-9]{17,19}$/.test(value)) return value;
    if (/^https?:\/\/(cdn\.discordapp\.com|media\.discordapp\.net)\//.test(value)) return value;
    if (!/^https?:\/\//.test(value)) return null; // data: URLs can't be fetched by Discord

    const cached = this.externalImages.get(value);
    if (cached) return cached;
    try {
      const [asset] = await RichPresence.getExternal(this.client as Client, PRESENCE_APP_ID, value);
      const path = (asset as { external_asset_path?: string } | undefined)?.external_asset_path;
      if (!path) return null;
      const resolved = `mp:${path}`;
      this.externalImages.set(value, resolved);
      return resolved;
    } catch (err) {
      logger.warn({ err, value }, "Could not upload presence image to Discord");
      return null;
    }
  }

  private applyPresence(): Promise<void> {
    const update = async (): Promise<void> => {
      if (!this.client?.isReady()) return;

      const client = this.client;
      const activities: object[] = [];
      const atype = this.state.activityType;
      const isStreamingStatus = this.state.status === "streaming";

      if (isStreamingStatus) {
        const streamTitle = this.state.statusStreamTitle?.trim() || "Twitch";
        const image = await this.resolveImage(this.state.statusImageUrl);
        // Discord always adds a fixed "Streaming" heading to native type-1
        // activities. Use a rich activity for the dashboard's Live status so the
        // selected artwork is rendered and only the user's title is displayed.
        activities.push({
          name: streamTitle,
          type: 0,
          application_id: PRESENCE_APP_ID,
          details: streamTitle,
          url: twitchUrl(this.state.statusTwitchId),
          ...(image
            ? {
                assets: {
                  large_image: image,
                  large_text: streamTitle,
                },
              }
            : {}),
        });
      } else if (atype === "spotify") {
        const now = Date.now();
        const trackDuration = 210000; // 3:30 default
        const image = (await this.resolveImage(this.state.activityImageUrl)) ?? "spotify:ab67616d0000b273";
        activities.push({
          name: "Spotify",
          type: 2, // LISTENING
          details: this.state.activitySongTitle ?? "Unknown Track",
          state: this.state.activityArtist ?? "Unknown Artist",
          assets: {
            large_image: image,
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
      } else if (atype === "playing" || atype === "watching" || atype === "competing") {
        const typeId = atype === "playing" ? "PLAYING" : atype === "watching" ? "WATCHING" : "COMPETING";
        const name =
          this.state.activitySongTitle ??
          (atype === "playing" ? "a game" : atype === "watching" ? "something" : "a tournament");
        const presence = new RichPresence(client)
          .setType(typeId)
          .setName(name)
          .setApplicationId(PRESENCE_APP_ID);
        const image = await this.resolveImage(this.state.activityImageUrl);
        if (image) {
          presence.setAssetsLargeImage(image).setAssetsLargeText(name);
        }
        activities.push(presence);
      }

      // Do not repeat the custom text beside a stream. Discord renders it as
      // another row and users commonly use the same value for the stream title.
      if (this.state.customText && !isStreamingStatus) {
        activities.push(new CustomStatus(client).setState(this.state.customText));
      }

      // setPresence() re-serialises activities through the library's Activity
      // class, which renames snake_case gateway fields (created_at, assets,
      // sync_id) to camelCase. Discord then ignores them and only this account's
      // own client renders the activity, so send the raw op 3 payload instead.
      const payload = {
        since: 0,
        afk: false,
        // Discord has no streaming status value; streaming is type 1 while online.
        status: isStreamingStatus ? "online" : this.state.status,
        activities: activities.map((a) =>
          typeof (a as { toJSON?: () => object }).toJSON === "function"
            ? (a as { toJSON: () => object }).toJSON()
            : a
        ),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ws = (client as any).ws;
      if (typeof ws?.broadcast === "function") {
        ws.broadcast({ op: 3, d: payload });
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await Promise.resolve(client.user!.setPresence(payload as any));
      }
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
