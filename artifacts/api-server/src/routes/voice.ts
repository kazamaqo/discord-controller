import { Router, type IRouter } from "express";
import { botManager } from "../lib/bot-manager";
import { musicManager } from "../lib/music-manager";
import { JoinVoiceBody, PlayMusicBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/voice/state", async (_req, res): Promise<void> => {
  res.json(musicManager.getState());
});

router.post("/voice/join", async (req, res): Promise<void> => {
  const parsed = JoinVoiceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const state = botManager.getState();
  if (!state.connected) {
    res.status(400).json({ error: "Bot not connected" });
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = (botManager as any).client;
  if (!client) {
    res.status(400).json({ error: "Bot client unavailable" });
    return;
  }
  try {
    const voiceState = await musicManager.join(client, parsed.data.guildId, parsed.data.channelId);
    res.json(voiceState);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to join channel";
    req.log.error({ err }, "Failed to join voice channel");
    res.status(400).json({ error: "Join failed", message });
  }
});

router.post("/voice/play", async (req, res): Promise<void> => {
  const parsed = PlayMusicBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const voiceState = await musicManager.play(parsed.data.query);
    res.json(voiceState);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Playback failed";
    req.log.error({ err }, "Playback failed");
    res.status(400).json({ error: "Playback failed", message });
  }
});

router.post("/voice/pause", async (_req, res): Promise<void> => {
  const voiceState = musicManager.pause();
  res.json(voiceState);
});

router.post("/voice/stop", async (_req, res): Promise<void> => {
  const voiceState = musicManager.stop();
  res.json(voiceState);
});

export default router;
