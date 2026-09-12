import { createHmac, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { Router } from "express";

const SESSION_COOKIE = "discord_controller_session";
const SESSION_MESSAGE = "discord-controller-dashboard-session";

function configuredPassword(): string {
  return process.env.DASHBOARD_PASSWORD?.trim() ?? "";
}

function sessionToken(password: string): Buffer {
  return createHmac("sha256", password).update(SESSION_MESSAGE).digest();
}

function cookieValue(request: Parameters<RequestHandler>[0]): string | null {
  const header = request.headers.cookie;
  if (!header) return null;

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    if (name !== SESSION_COOKIE) continue;

    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }

  return null;
}

function hasValidSession(request: Parameters<RequestHandler>[0]): boolean {
  const password = configuredPassword();
  const provided = cookieValue(request);
  if (!password || !provided) return false;

  const expected = sessionToken(password);
  const actual = Buffer.from(provided, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export const dashboardAuthRouter = Router();

dashboardAuthRouter.post("/auth/login", (request, response) => {
  const password = configuredPassword();
  if (!password) {
    response.status(503).json({ error: "Dashboard password is not configured" });
    return;
  }

  const supplied = typeof request.body?.password === "string"
    ? request.body.password
    : "";
  const expected = sessionToken(password);
  const actual = sessionToken(supplied);

  if (!timingSafeEqual(actual, expected)) {
    response.status(401).json({ error: "Invalid dashboard password" });
    return;
  }

  response.cookie(SESSION_COOKIE, expected.toString("hex"), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
  response.json({ authenticated: true });
});

dashboardAuthRouter.get("/auth/session", (request, response) => {
  if (hasValidSession(request)) {
    response.json({ authenticated: true });
    return;
  }

  response.status(401).json({ authenticated: false });
});

dashboardAuthRouter.post("/auth/logout", (_request, response) => {
  response.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: "lax", path: "/" });
  response.json({ authenticated: false });
});

export const requireDashboardAuth: RequestHandler = (request, response, next) => {
  if (request.path === "/healthz" || request.path.startsWith("/auth/")) {
    next();
    return;
  }

  if (!hasValidSession(request)) {
    response.status(401).json({ error: "Dashboard authentication required" });
    return;
  }

  next();
};