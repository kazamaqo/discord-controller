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

  async join(client: Client, guildId: string, channelId: string): Promise<VoiceState> {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) throw new Error("Guild not found");

    const channel = guild.channels.cache.get(channelId);
    if (!channel) throw new Error("Channel not found");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.connection = joinVoiceChannel({
      channelId,
      guildId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      adapterCreator: guild.voiceAdapterCreator as any,
      selfDeaf: false,
    });

    await entersState(this.connection, VoiceConnectionStatus.Ready, 15_000);

    this.connection.on("stateChange", (_, newState) => {
      if (newState.status === VoiceConnectionStatus.Disconnected) {
        this.cleanup();
      }
    });

    this.state = {
      ...this.state,
      inVoice: true,
      channelId,
      channelName: channel.name ?? null,
      guildId,
      guildName: guild.name,
    };

    logger.info({ guildId, channelId }, "Joined voice channel");
    return this.getState();
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

const musicManagers = new Map<string, MusicManager>();

export function getMusicManager(accountId = "primary"): MusicManager {
  const existing = musicManagers.get(accountId);
  if (existing) return existing;
  const manager = new MusicManager();
  musicManagers.set(accountId, manager);
  return manager;
}

export const musicManager = getMusicManager("primary");
