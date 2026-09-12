import { Router, type IRouter, type Request } from "express";
import { getBotManager, type AccountId } from "../lib/bot-manager";
import { ChangeUsernameBody, ChangeNicknameBody } from "@workspace/api-zod";

const router: IRouter = Router();

function accountIdFromRequest(req: Request): AccountId {
  return req.get("x-discord-account") === "secondary" ? "secondary" : "primary";
}

router.get("/profile/guilds", async (req, res): Promise<void> => {
  const client = getBotManager(accountIdFromRequest(req)).getClient();
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
  const manager = getBotManager(accountIdFromRequest(req));
  if (!manager.getState().connected) {
    res.status(400).json({ error: "Bot not connected" });
    return;
  }
  const client = manager.getClient();
  if (!client?.user) {
    res.status(400).json({ error: "Bot client unavailable" });
    return;
  }
  try {
    await client.user.edit({ username: parsed.data.username, password: parsed.data.password });
    const updated = manager.getState();
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
  const manager = getBotManager(accountIdFromRequest(req));
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
