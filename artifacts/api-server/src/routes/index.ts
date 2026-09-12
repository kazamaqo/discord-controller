import { Router, type IRouter } from "express";
import healthRouter from "./health";
import botRouter from "./bot";
import whitelistRouter from "./whitelist";
import voiceRouter from "./voice";
import profileRouter from "./profile";

const router: IRouter = Router();

router.use(healthRouter);
router.use(botRouter);
router.use(whitelistRouter);
router.use(voiceRouter);
router.use(profileRouter);

export default router;
