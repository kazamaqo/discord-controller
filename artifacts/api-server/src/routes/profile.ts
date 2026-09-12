import { Router, type IRouter } from "express";
import { botManager } from "../lib/bot-manager";
import { ChangeUsernameBody, ChangeNicknameBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/profile/guilds", async (_req, res): Promise<void> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = (botManager as any).client;
  if (!client) {
    res.json([]);
    return;
  }
  const guilds = client.guilds.cache.map((g: { id: string; name: string; iconURL?: (opts: object) => string | null; memberCount?: number }) => ({
    id: g.id,
    name: g.name,
    iconUrl: g.iconURL ? g.iconURL({ dynamic: true }) : null,
    memberCount: g.memberCount ?? null,
  }));
  res.json(guilds);
});

router.post("/profile/username", async (req, res): Promise<void> => {
  const parsed = ChangeUsernameBody.safeParse(req.body);
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
  if (!client?.user) {
    res.status(400).json({ error: "Bot client unavailable" });
    return;
  }
  try {
    await client.user.edit({ username: parsed.data.username, password: parsed.data.password });
    const updated = botManager.getState();
    // Refresh username from client
    updated.username = client.user.username;
    updated.discriminator = client.user.discriminator;
    res.json(updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to change username";
    req.log.error({ err }, "Username change failed");
    res.status(400).json({ error: "Username change failed", message });
  }
});

router.post("/profile/nickname", async (req, res): Promise<void> => {
  const parsed = ChangeNicknameBody.safeParse(req.body);
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
    const guild = client.guilds.cache.get(parsed.data.guildId);
    if (!guild) {
      res.status(400).json({ error: "Guild not found" });
      return;
    }
    await guild.members.me.setNickname(parsed.data.nickname);
    res.json({ error: "Nickname updated successfully" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to change nickname";
    req.log.error({ err }, "Nickname change failed");
    res.status(400).json({ error: "Nickname change failed", message });
  }
});

export default router;
