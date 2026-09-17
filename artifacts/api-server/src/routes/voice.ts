import { Router, type IRouter, type Request } from "express";
import { accountIdFromValue, getBotManager, isAccountId, type AccountId } from "../lib/bot-manager";
import { getMusicManager } from "../lib/music-manager";
import { JoinVoiceBody, JoinAllVoiceBody, PlayMusicBody } from "@workspace/api-zod";

const router: IRouter = Router();

function accountIdFromRequest(req: Request): AccountId {
  return accountIdFromValue(req.get("x-discord-account"));
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

router.post("/voice/join-all", async (req, res): Promise<void> => {
  const parsed = JoinAllVoiceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Select at least one valid account and provide a guild and channel" });
    return;
  }

  const requestedAccountIds = [...new Set(parsed.data.accountIds)];
  if (requestedAccountIds.some((accountId) => !isAccountId(accountId))) {
    res.status(400).json({ error: "One or more selected accounts are invalid" });
    return;
  }
  const accountIds = requestedAccountIds as AccountId[];

  const results = await Promise.all(
    accountIds.map(async (accountId) => {
      const manager = getBotManager(accountId);
      if (!manager.getState().connected) {
        return { accountId, ok: false, error: "Account not connected" };
      }

      const client = manager.getClient();
      if (!client) {
        return { accountId, ok: false, error: "Bot client unavailable" };
      }

      try {
        const state = await getMusicManager(accountId).join(client, parsed.data.guildId, parsed.data.channelId);
        return { accountId, ok: true, state };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to join channel";
        req.log.error({ err, accountId }, "Failed to join voice channel for account");
        return { accountId, ok: false, error: message };
      }
    }),
  );

  res.json({
    results,
    joined: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
  });
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
