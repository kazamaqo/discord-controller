import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  StreamType,
  type VoiceConnection,
  type AudioPlayer,
} from "@discordjs/voice";
import ytdl from "@distube/ytdl-core";
import { type Client } from "discord.js-selfbot-v13";
import { logger } from "./logger";
import type { AccountId } from "./bot-manager";

export interface VoiceState {
  inVoice: boolean;
  channelId: string | null;
  channelName: string | null;
  guildId: string | null;
  guildName: string | null;
  paused: boolean;
  currentTrack: string | null;
  currentTrackTitle: string | null;
}

export class MusicManager {
  constructor(private readonly accountId: AccountId) {}

  private connection: VoiceConnection | null = null;
  private player: AudioPlayer | null = null;
  private state: VoiceState = {
    inVoice: false,
    channelId: null,
    channelName: null,
    guildId: null,
    guildName: null,
    paused: false,
    currentTrack: null,
    currentTrackTitle: null,
  };

  getState(): VoiceState {
    return { ...this.state };
  }

  // Where this account should stay. Kept until stop() so the watchdog can
  // rejoin after Discord drops the call (the ~30h forced disconnects, voice
  // server moves, network blips, or a full gateway reconnect).
  private target: { guildId: string; channelId: string } | null = null;
  private watchdog: NodeJS.Timeout | null = null;
  private rejoining = false;
  private lastClient: Client | null = null;

  async join(client: Client, guildId: string, channelId: string): Promise<VoiceState> {
    this.target = { guildId, channelId };
    this.lastClient = client;
    this.startWatchdog();
    return this.connect(client, guildId, channelId);
  }

  private async connect(client: Client, guildId: string, channelId: string): Promise<VoiceState> {
    let guild = client.guilds.cache.get(guildId);
    if (!guild) {
      // Cache can be stale right after a gateway reconnect; refetch once.
      guild = await client.guilds.fetch(guildId).catch(() => undefined);
    }
    if (!guild) throw new Error("Guild not found");

    let channel = guild.channels.cache.get(channelId);
    if (!channel) {
      const fetched = await guild.channels.fetch(channelId).catch(() => null);
      if (fetched) channel = fetched as typeof channel;
    }
    if (!channel) throw new Error("Channel not found");

    if (this.connection) {
      try { this.connection.destroy(); } catch { /* already gone */ }
      this.connection = null;
    }

    const connection = joinVoiceChannel({
      channelId,
      guildId,
      // Keep each account in its own @discordjs/voice connection group.
      group: this.accountId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      adapterCreator: guild.voiceAdapterCreator as any,
      selfDeaf: false,
    });
    this.connection = connection;

    connection.on("stateChange", (_, newState) => {
      if (this.connection !== connection) return;
      if (newState.status === VoiceConnectionStatus.Disconnected) {
        void this.recover(connection);
      } else if (newState.status === VoiceConnectionStatus.Destroyed && this.target) {
        this.state.inVoice = false;
        void this.rejoinSoon(1000);
      }
    });
    connection.on("error", (err) => {
      logger.warn({ err, accountId: this.accountId }, "Voice connection error; rejoining");
      void this.rejoinSoon(1000);
    });

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    } catch (error) {
      if (this.connection === connection) {
        try { connection.destroy(); } catch { /* ignore */ }
        this.connection = null;
      }
      throw error;
    }

    // Re-attach music if a player already exists.
    if (this.player) connection.subscribe(this.player);

    this.state = {
      ...this.state,
      inVoice: true,
      channelId,
      channelName: channel.name ?? null,
      guildId,
      guildName: guild.name,
    };

    logger.info({ guildId, channelId, accountId: this.accountId }, "Joined voice channel");
    return this.getState();
  }

  /** Fast path: let Discord move us to a new voice server, otherwise rejoin. */
  private async recover(connection: VoiceConnection): Promise<void> {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 3_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 3_000),
      ]);
      // Reconnecting on its own (region move). Watchdog covers a stall.
    } catch {
      this.state.inVoice = false;
      await this.rejoinSoon(500);
    }
  }

  private async rejoinSoon(delayMs: number): Promise<void> {
    if (!this.target || this.rejoining) return;
    this.rejoining = true;
    try {
      let wait = delayMs;
      // Never give up: keep retrying until stop() clears the target.
      for (let attempt = 0; this.target; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, wait));
        if (!this.target) return;
        const client = await this.currentClient();
        if (!client) { wait = Math.min(wait * 2, 15_000); continue; }
        try {
          await this.connect(client, this.target.guildId, this.target.channelId);
          logger.info({ accountId: this.accountId }, "Voice auto-reconnected");
          return;
        } catch (err) {
          logger.warn({ err, accountId: this.accountId, attempt }, "Voice rejoin failed");
          wait = Math.min(wait * 2, 15_000);
        }
      }
    } finally {
      this.rejoining = false;
    }
  }

  private async currentClient(): Promise<Client | null> {
    try {
      const { getBotManager } = await import("./bot-manager");
      const client = getBotManager(this.accountId).getClient() as unknown as Client | null;
      if (client) this.lastClient = client;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ready = client && typeof (client as any).isReady === "function" ? (client as any).isReady() : !!client;
      return ready ? client : null;
    } catch {
      return this.lastClient;
    }
  }

  /**
   * The voice library can keep reporting Ready after Discord silently drops
   * the account from the channel (the long-session kills around ~80h). Check
   * the gateway client's own voice state, not just the connection status.
   */
  private async verifyInChannel(): Promise<void> {
    if (!this.target) return;
    const status = this.connection?.state.status;
    const healthy = status === VoiceConnectionStatus.Ready
      || status === VoiceConnectionStatus.Connecting
      || status === VoiceConnectionStatus.Signalling;
    if (!healthy) {
      void this.rejoinSoon(0);
      return;
    }
    const client = await this.currentClient();
    if (!client) return;
    const guild = client.guilds.cache.get(this.target.guildId);
    // Cache can be empty right after a gateway reconnect; the rejoin loop
    // waits for the cache and retries, so treat a missing guild as dropped.
    const me = guild?.members.me
      ?? (client.user ? guild?.members.cache.get(client.user.id) : null);
    const actual = me?.voice?.channelId ?? null;
    if (actual !== this.target.channelId) {
      logger.warn({ accountId: this.accountId, actual }, "Voice watchdog: not in target channel; rejoining");
      this.state.inVoice = false;
      void this.rejoinSoon(0);
    }
  }

  /** Every 10s make sure we are really sitting in the target channel. */
  private startWatchdog(): void {
    if (this.watchdog) return;
    this.watchdog = setInterval(() => {
      if (!this.target || this.rejoining) return;
      void this.verifyInChannel();
    }, 10_000);
    this.watchdog.unref?.();
  }

  async play(query: string): Promise<VoiceState> {
    if (!this.connection) throw new Error("Not in a voice channel. Join a voice channel first.");

    if (!this.player) {
      this.player = createAudioPlayer();
      this.connection.subscribe(this.player);

      this.player.on(AudioPlayerStatus.Idle, () => {
        this.state.currentTrack = null;
        this.state.currentTrackTitle = null;
        this.state.paused = false;
      });

      this.player.on("error", (err) => {
        logger.error({ err }, "Audio player error");
        this.state.currentTrack = null;
        this.state.currentTrackTitle = null;
      });
    }

    // Resolve YouTube URL from query
    let url = query;
    let title = query;

    if (!ytdl.validateURL(query)) {
      // Treat as search — build a YouTube search URL for ytdl
      throw new Error("Please provide a full YouTube URL (e.g. https://youtube.com/watch?v=...)");
    }

    try {
      const info = await ytdl.getInfo(url);
      title = info.videoDetails.title;
    } catch {
      // Non-fatal — proceed with URL as title
    }

    const stream = ytdl(url, {
      filter: "audioonly",
      quality: "highestaudio",
      highWaterMark: 1 << 25,
    });

    const resource = createAudioResource(stream, {
      inputType: StreamType.Arbitrary,
    });

    this.player.play(resource);
    this.state.currentTrack = url;
    this.state.currentTrackTitle = title;
    this.state.paused = false;

    logger.info({ title }, "Playing track");
    return this.getState();
  }

  pause(): VoiceState {
    if (!this.player) return this.getState();
    if (this.state.paused) {
      this.player.unpause();
      this.state.paused = false;
    } else {
      this.player.pause();
      this.state.paused = true;
    }
    return this.getState();
  }

  stop(): VoiceState {
    // Explicit leave: stop auto-reconnecting.
    this.target = null;
    if (this.watchdog) {
      clearInterval(this.watchdog);
      this.watchdog = null;
    }
    if (this.player) {
      this.player.stop();
    }
    if (this.connection) {
      this.connection.destroy();
    }
    this.cleanup();
    return this.getState();
  }

  private cleanup(): void {
    this.connection = null;
    this.player = null;
    this.state = {
      inVoice: false,
      channelId: null,
      channelName: null,
      guildId: null,
      guildName: null,
      paused: false,
      currentTrack: null,
      currentTrackTitle: null,
    };
  }
}

const musicManagers = new Map<AccountId, MusicManager>();

export function getMusicManager(accountId: AccountId = "primary"): MusicManager {
  const existing = musicManagers.get(accountId);
  if (existing) return existing;
  const manager = new MusicManager(accountId);
  musicManagers.set(accountId, manager);
  return manager;
}

export const musicManager = getMusicManager("primary");
