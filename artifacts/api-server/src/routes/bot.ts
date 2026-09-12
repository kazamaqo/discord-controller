import { Router, type IRouter } from "express";
import { botManager } from "../lib/bot-manager";
import {
  ConnectBotBody,
  SetStatusBody,
  SetActivityBody,
  MassDmBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/bot/connect", async (req, res): Promise<void> => {
  const parsed = ConnectBotBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const state = await botManager.connect(parsed.data.token);
    res.json(state);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to connect";
    req.log.error({ err }, "Bot connection failed");
    res.status(400).json({ error: "Connection failed", message });
  }
});

router.post("/bot/disconnect", async (_req, res): Promise<void> => {
  const state = await botManager.disconnect();
  res.json(state);
});

router.get("/bot/state", async (_req, res): Promise<void> => {
  res.json(botManager.getState());
});

router.post("/bot/status", async (req, res): Promise<void> => {
  const parsed = SetStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const state = botManager.getState();
  if (!state.connected) {
    res.status(400).json({ error: "Bot not connected" });
    return;
  }
  const updated = await botManager.setStatus(
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
  const state = botManager.getState();
  if (!state.connected) {
    res.status(400).json({ error: "Bot not connected" });
    return;
  }
  const updated = await botManager.setActivity(
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
  const state = botManager.getState();
  if (!state.connected) {
    res.status(400).json({ error: "Bot not connected" });
    return;
  }
  const whitelist = botManager.getWhitelist();
  if (!whitelist.length) {
    res.status(400).json({ error: "Whitelist is empty" });
    return;
  }
  try {
    const result = await botManager.massDm(parsed.data.message);
    res.json(result);
  } catch (err: unknown) {
    req.log.error({ err }, "Mass DM failed");
    res.status(400).json({ error: "Mass DM failed" });
  }
});

export default router;
