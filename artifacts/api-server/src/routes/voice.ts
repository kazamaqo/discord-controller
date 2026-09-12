import { Router, type IRouter, type Request } from "express";
import { getBotManager, type AccountId } from "../lib/bot-manager";
import { getMusicManager } from "../lib/music-manager";
import { JoinVoiceBody, PlayMusicBody } from "@workspace/api-zod";

const router: IRouter = Router();

function accountIdFromRequest(req: Request): AccountId {
  return req.get("x-discord-account") === "secondary" ? "secondary" : "primary";
}

router.get("/voice/state", async (req, res): Promise<void> => {
  res.json(getMusicManager(accountIdFromRequest(req)).getState());
});

router.post("/voice/join", async (req, res): Promise<void> => {
  const parsed = JoinVoiceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const accountId = accountIdFromRequest(req);
  const manager = getBotManager(accountId);
  if (!manager.getState().connected) {
    res.status(400).json({ error: "Bot not connected" });
    return;
  }
  const client = manager.getClient();
  if (!client) {
    res.status(400).json({ error: "Bot client unavailable" });
    return;
  }
  try {
    const voiceState = await getMusicManager(accountId).join(client, parsed.data.guildId, parsed.data.channelId);
    res.json(voiceState);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to join channel";
    req.log.error({ err, accountId }, "Failed to join voice channel");
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
    const voiceState = await getMusicManager(accountIdFromRequest(req)).play(parsed.data.query);
    res.json(voiceState);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Playback failed";
    req.log.error({ err }, "Playback failed");
    res.status(400).json({ error: "Playback failed", message });
  }
});

router.post("/voice/pause", async (req, res): Promise<void> => {
  res.json(getMusicManager(accountIdFromRequest(req)).pause());
});

router.post("/voice/stop", async (req, res): Promise<void> => {
  res.json(getMusicManager(accountIdFromRequest(req)).stop());
});

export default router;
