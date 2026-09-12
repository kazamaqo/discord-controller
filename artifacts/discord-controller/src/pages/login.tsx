import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

type AccountSummary = {
  id: AccountId;
  label: string;
  state: { connected: boolean; username?: string | null; userId?: string | null };
};

type AccountId = "primary" | "secondary" | "account3" | "account4" | "account5";
const ACCOUNT_IDS = ["primary", "secondary", "account3", "account4", "account5"] as const;
const fallbackAccountLabel = (accountId: AccountId) => `Account ${ACCOUNT_IDS.indexOf(accountId) + 1}`;

export default function Login() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [accessState, setAccessState] = useState<"checking" | "locked" | "unlocked">("checking");
  const [dashboardPassword, setDashboardPassword] = useState("");
  const [passwordPending, setPasswordPending] = useState(false);
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [tokens, setTokens] = useState<Record<AccountId, string>>({
    primary: "",
    secondary: "",
    account3: "",
    account4: "",
    account5: "",
  });
  const [pendingAccount, setPendingAccount] = useState<AccountId | null>(null);

  const loadAccounts = async () => {
    const response = await fetch("/api/bot/accounts", { credentials: "same-origin" });
    if (response.ok) setAccounts(await response.json());
  };

  useEffect(() => {
    fetch("/api/auth/session", { credentials: "same-origin" })
      .then((response) => setAccessState(response.ok ? "unlocked" : "locked"))
      .catch(() => setAccessState("locked"));
  }, []);

  useEffect(() => {
    if (accessState === "unlocked") void loadAccounts().catch(() => undefined);
  }, [accessState]);

  const unlockDashboard = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordPending(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: dashboardPassword }),
      });
      if (!response.ok) {
        toast({
          title: response.status === 503 ? "Dashboard password is not configured" : "Invalid dashboard password",
          variant: "destructive",
        });
        return;
      }
      setDashboardPassword("");
      setAccessState("unlocked");
    } catch {
      toast({ title: "Unable to reach the dashboard", variant: "destructive" });
    } finally {
      setPasswordPending(false);
    }
  };

  const connectAccount = async (accountId: (typeof ACCOUNT_IDS)[number]) => {
    const token = tokens[accountId]?.trim();
    if (!token) return;
    setPendingAccount(accountId);
    try {
      const response = await fetch("/api/bot/connect", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, accountId }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.message || error?.error || "Connection failed");
      }
      window.localStorage.setItem("discord-active-account", accountId);
      setTokens((current) => ({ ...current, [accountId]: "" }));
      setLocation(`/dashboard/${accountId}`);
    } catch (error) {
      toast({ title: error instanceof Error ? error.message : "Invalid token", variant: "destructive" });
      await loadAccounts().catch(() => undefined);
    } finally {
      setPendingAccount(null);
    }
  };

  if (accessState === "checking") {
    return <div className="min-h-screen bg-black flex items-center justify-center p-4"><p className="text-red-500 font-bold tracking-widest uppercase">Checking access...</p></div>;
  }

  if (accessState === "locked") {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-6">
          <p className="text-red-500 text-center font-bold text-xl tracking-widest uppercase">Dashboard password</p>
          <form onSubmit={unlockDashboard} className="space-y-4">
            <Input type="password" value={dashboardPassword} onChange={(event) => setDashboardPassword(event.target.value)} placeholder="password..." autoComplete="current-password" className="bg-[#0a0a0a] border-[#222] text-white font-mono h-12 focus-visible:ring-red-500" required />
            <Button type="submit" className="w-full h-11 bg-red-600 hover:bg-red-700 text-white font-bold uppercase tracking-widest" disabled={passwordPending || dashboardPassword.length === 0}>{passwordPending ? "Checking..." : "Unlock"}</Button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-2xl space-y-6">
        <div className="text-center space-y-2">
          <p className="text-red-500 font-bold text-xl tracking-widest uppercase">Discord account controller</p>
          <p className="text-zinc-500 text-sm font-mono">Connect up to five accounts. They run independently and can join voice channels together.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {ACCOUNT_IDS.map((accountId) => {
            const account = accounts.find((item) => item.id === accountId);
            const connected = account?.state.connected;
            return (
              <div key={accountId} className="rounded-xl border border-[#222] bg-[#0a0a0a] p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-white font-bold uppercase tracking-widest">{account?.label || fallbackAccountLabel(accountId)}</p>
                    <p className="text-xs text-zinc-500 font-mono">{connected ? "Connected as " + (account?.state.username || "unknown") : "Not connected"}</p>
                  </div>
                  <span className={connected ? "text-green-500 text-xs" : "text-zinc-600 text-xs"}>{connected ? "● ONLINE" : "○ OFFLINE"}</span>
                </div>
                <Input type="password" value={tokens[accountId]} onChange={(event) => setTokens((current) => ({ ...current, [accountId]: event.target.value }))} placeholder="Paste user token..." className="bg-black border-[#222] text-white font-mono h-11" />
                <Button onClick={() => void connectAccount(accountId)} className="w-full h-11 bg-red-600 hover:bg-red-700 text-white font-bold uppercase tracking-widest" disabled={pendingAccount !== null || !tokens[accountId].trim()}>{pendingAccount === accountId ? "Connecting..." : connected ? "Reconnect account" : "Connect account"}</Button>
                {connected && <Button variant="outline" onClick={() => { window.localStorage.setItem("discord-active-account", accountId); setLocation(`/dashboard/${accountId}`); }} className="w-full border-[#333] text-zinc-300">Open dashboard</Button>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
