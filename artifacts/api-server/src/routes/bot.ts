import { Router, type IRouter, type Request } from "express";
import { accountIdFromValue, getAccountSummaries, getBotManager, type AccountId } from "../lib/bot-manager";
import { getMusicManager } from "../lib/music-manager";
import {
  ConnectBotBody,
  SetStatusBody,
  SetActivityBody,
  MassDmBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

function accountIdFromRequest(req: Request, bodyAccountId?: unknown): AccountId {
  return accountIdFromValue(bodyAccountId ?? req.get("x-discord-account"));
}

router.get("/bot/accounts", async (_req, res): Promise<void> => {
  res.json(getAccountSummaries());
});

router.post("/bot/connect", async (req, res): Promise<void> => {
  const parsed = ConnectBotBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const accountId = accountIdFromRequest(req, req.body?.accountId);
  const manager = getBotManager(accountId);
  try {
    const state = await manager.connect(parsed.data.token);
    try {
      await saveAccountToken(accountId, parsed.data.token);
    } catch (error) {
      req.log.error({ err: error, accountId }, "Account connected but token persistence failed");
      res.status(503).json({ error: "Account connected but persistent token storage is unavailable" });
      return;
    }
    if (accountId === "secondary") installSecondaryCommandListener();
    res.json(state);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to connect";
    req.log.error({ err, accountId }, "Bot connection failed");
    res.status(400).json({ error: "Connection failed", message });
  }
});

router.post("/bot/disconnect", async (req, res): Promise<void> => {
  const accountId = accountIdFromRequest(req);
  const state = await getBotManager(accountId).disconnect();
  getMusicManager(accountId).stop();
  res.json(state);
});

router.get("/bot/state", async (req, res): Promise<void> => {
  res.json(getBotManager(accountIdFromRequest(req)).getState());
});

router.post("/bot/status", async (req, res): Promise<void> => {
  const parsed = SetStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const manager = getBotManager(accountIdFromRequest(req));
  if (!manager.getState().connected) {
    res.status(400).json({ error: "Bot not connected" });
    return;
  }
  const updated = await manager.setStatus(
    parsed.data.status as "online" | "idle" | "dnd" | "invisible" | "streaming",
    parsed.data.customText,
    parsed.data.streamTitle,
    parsed.data.twitchId
  );
  res.json(updated);
});

router.post("/bot/activity", async (req, res): Promise<void> => {
  const parsed = SetActivityBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const manager = getBotManager(accountIdFromRequest(req));
  if (!manager.getState().connected) {
    res.status(400).json({ error: "Bot not connected" });
    return;
  }
  const updated = await manager.setActivity(
    parsed.data.type as "none" | "spotify" | "playing" | "watching" | "competing",
    parsed.data.songTitle,
    parsed.data.artist,
    parsed.data.album,
    parsed.data.imageUrl,
    parsed.data.twitchId
  );
  res.json(updated);
});

router.post("/bot/mass-dm", async (req, res): Promise<void> => {
  const parsed = MassDmBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const manager = getBotManager(accountIdFromRequest(req));
  if (!manager.getState().connected) {
    res.status(400).json({ error: "Bot not connected" });
    return;
  }
  if (!manager.getWhitelist().length) {
    res.status(400).json({ error: "Whitelist is empty" });
    return;
  }
  try {
    const result = await manager.massDm(parsed.data.message);
    res.json(result);
  } catch (err: unknown) {
    req.log.error({ err }, "Mass DM failed");
    res.status(400).json({ error: "Mass DM failed" });
  }
});

export default router;
