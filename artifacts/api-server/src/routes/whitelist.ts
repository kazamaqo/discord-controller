import { Router, type IRouter } from "express";
import { botManager } from "../lib/bot-manager";
import { AddToWhitelistBody, RemoveFromWhitelistParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/whitelist", async (_req, res): Promise<void> => {
  res.json(botManager.getWhitelist());
});

router.post("/whitelist", async (req, res): Promise<void> => {
  const parsed = AddToWhitelistBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const entry = botManager.addToWhitelist(parsed.data.userId, parsed.data.label);
  res.status(201).json(entry);
});

router.delete("/whitelist/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = RemoveFromWhitelistParams.safeParse({ id: raw });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const removed = botManager.removeFromWhitelist(params.data.id);
  if (!removed) {
    res.status(404).json({ error: "Entry not found" });
    return;
  }
  res.json({ error: "Removed successfully" });
});

export default router;
