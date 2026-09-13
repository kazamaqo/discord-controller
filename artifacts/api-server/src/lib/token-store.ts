import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
    import { getBotManager, ACCOUNT_IDS, type AccountId } from "./bot-manager";
    import { installAccountAutomationListener, installSecondaryCommandListener } from "./command-listener";
    import { logger } from "./logger";

    const TABLE_SQL = "CREATE TABLE IF NOT EXISTS discord_account_tokens (account_id TEXT PRIMARY KEY, encrypted_token TEXT NOT NULL, iv TEXT NOT NULL, auth_tag TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())";
    let poolPromise: Promise<any> | null = null;

    async function getPool(): Promise<any> {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for persistent account tokens");
    if (!poolPromise) poolPromise = import("@workspace/db").then(({ pool }) => pool);
    return poolPromise;
    }

    function encryptionKey(): Buffer {
    const secret = process.env.DASHBOARD_PASSWORD ?? process.env.SESSION_SECRET;
    if (!secret) throw new Error("DASHBOARD_PASSWORD or SESSION_SECRET is required for token encryption");
    return createHash("sha256").update("discord-account-tokens:" + secret).digest();
    }

    function encryptToken(token: string): { encryptedToken: string; iv: string; authTag: string } {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
    return { encryptedToken: encrypted.toString("base64"), iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64") };
    }

    function decryptToken(row: { encrypted_token: string; iv: string; auth_tag: string }): string {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(row.iv, "base64"));
    decipher.setAuthTag(Buffer.from(row.auth_tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(row.encrypted_token, "base64")), decipher.final()]).toString("utf8");
    }

    async function ensureTable(pool: any): Promise<void> { await pool.query(TABLE_SQL); }

    export async function saveAccountToken(accountId: AccountId, token: string): Promise<void> {
    const pool = await getPool();
    await ensureTable(pool);
    const encrypted = encryptToken(token);
    await pool.query("INSERT INTO discord_account_tokens (account_id, encrypted_token, iv, auth_tag) VALUES ($1, $2, $3, $4) ON CONFLICT (account_id) DO UPDATE SET encrypted_token = EXCLUDED.encrypted_token, iv = EXCLUDED.iv, auth_tag = EXCLUDED.auth_tag, updated_at = NOW()", [accountId, encrypted.encryptedToken, encrypted.iv, encrypted.authTag]);
    }

    async function loadAccountTokens(): Promise<Map<AccountId, string>> {
    const pool = await getPool();
    await ensureTable(pool);
    const result = await pool.query("SELECT account_id, encrypted_token, iv, auth_tag FROM discord_account_tokens");
    const tokens = new Map<AccountId, string>();
    for (const row of result.rows) if ((ACCOUNT_IDS as readonly string[]).includes(row.account_id)) tokens.set(row.account_id as AccountId, decryptToken(row));
    return tokens;
    }

    export async function restoreSavedAccounts(): Promise<void> {
    if (!process.env.DATABASE_URL) { logger.warn("DATABASE_URL is not configured; saved Discord accounts will not be restored"); return; }
    try {
      const tokens = await loadAccountTokens();
      for (const accountId of ACCOUNT_IDS) {
        const token = tokens.get(accountId);
        if (!token) continue;
        try {
          await getBotManager(accountId).connect(token);
          if (accountId === "secondary") installSecondaryCommandListener();
          installAccountAutomationListener(accountId);
          logger.info({ accountId }, "Restored saved Discord account");
        } catch { logger.warn({ accountId }, "Saved Discord account could not be restored"); }
      }
    } catch { logger.warn("Saved Discord accounts could not be loaded"); }
    }
    