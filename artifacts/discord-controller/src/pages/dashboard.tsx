import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { 
  LogOut, 
  Activity, 
  Settings, 
  Users, 
  Circle,
  Plus,
  Trash2,
  Save,
  Moon,
  MinusCircle,
  EyeOff,
  Music,
  Play,
  Pause,
  Square,
  Mic,
  UserCircle,
  AlertTriangle,
  Send,
  CheckCircle,
  XCircle,
  Gamepad2,
  Tv,
  MonitorPlay,
  Swords,
  Music2,
  ImagePlus,
  Link,
  Zap
} from "lucide-react";

import {
  useGetBotState,
  useDisconnectBot,
  useSetStatus,
  useGetWhitelist,
  useAddToWhitelist,
  useRemoveFromWhitelist,
  getGetBotStateQueryKey,
  getGetWhitelistQueryKey,
  useJoinVoice,
  usePlayMusic,
  usePauseMusic,
  useStopMusic,
  useGetVoiceState,
  getGetVoiceStateQueryKey,
  useChangeUsername,
  useChangeNickname,
  useGetGuilds,
  getGetGuildsQueryKey,
  useSetActivity,
  useMassDm
} from "@workspace/api-client-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type AccountId = "primary" | "secondary" | "account3" | "account4" | "account5" | "account6" | "account7" | "account8" | "account9" | "account10";
const ACCOUNT_IDS = ["primary", "secondary", "account3", "account4", "account5", "account6", "account7", "account8", "account9", "account10"] as const;

type AutoreactStatus = {
  active: boolean;
  targetUserId: string | null;
  targetLabel: string | null;
  emojiId: string | null;
  channelId: string | null;
  accountIds: AccountId[];
  stats?: {
    matched: number;
    reacted: number;
    failed: number;
    lastError: string | null;
    lastMatchedAt: string | null;
    lastReactedAt: string | null;
  };
};

function accountIdFromPath(path: string): AccountId | null {
  const match = path.match(/^\/dashboard\/(primary|secondary|account3|account4|account5|account6|account7|account8|account9|account10)\/?$/);
  return match ? (match[1] as AccountId) : null;
}

export default function Dashboard() {
  const [location, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const routeAccountId = accountIdFromPath(location);
  const [activeAccountId, setActiveAccountId] = useState<AccountId>(() => {
    if (typeof window === "undefined") return "primary";
    if (routeAccountId) return routeAccountId;
    const stored = window.localStorage.getItem("discord-active-account");
    return ACCOUNT_IDS.includes(stored as AccountId) ? (stored as AccountId) : "primary";
  });
  const [accountSummaries, setAccountSummaries] = useState<Array<{
    id: AccountId;
    label: string;
    state: { connected: boolean; username?: string | null };
  }>>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);

  const loadAccountSummaries = async () => {
    try {
      const response = await fetch("/api/bot/accounts", { credentials: "same-origin" });
      if (response.ok) setAccountSummaries(await response.json());
    } finally {
      setAccountsLoaded(true);
    }
  };

  useEffect(() => {
    void loadAccountSummaries().catch(() => undefined);
    const interval = window.setInterval(() => void loadAccountSummaries().catch(() => undefined), 5000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!routeAccountId || routeAccountId === activeAccountId) return;
    window.localStorage.setItem("discord-active-account", routeAccountId);
    setActiveAccountId(routeAccountId);
    queryClient.invalidateQueries();
  }, [routeAccountId, activeAccountId, queryClient]);

  const switchAccount = (accountId: AccountId) => {
    window.localStorage.setItem("discord-active-account", accountId);
    setActiveAccountId(accountId);
    setLocation(`/dashboard/${accountId}`);
    queryClient.invalidateQueries();
  };

  const { data: botState, isLoading: stateLoading } = useGetBotState({
    query: {
      refetchInterval: 5000,
      queryKey: [...getGetBotStateQueryKey(), activeAccountId],
    }
  });

  const { data: whitelist = [], isLoading: whitelistLoading } = useGetWhitelist({
    query: { queryKey: [...getGetWhitelistQueryKey(), activeAccountId] },
  });
  
  const { data: guilds = [] } = useGetGuilds({ query: { queryKey: [...getGetGuildsQueryKey(), activeAccountId] } });
  const { data: voiceState } = useGetVoiceState({
    query: {
      refetchInterval: 3000,
      queryKey: [...getGetVoiceStateQueryKey(), activeAccountId],
    }
  });

  const disconnectBot = useDisconnectBot();
  const setStatus = useSetStatus();
  const addToWhitelist = useAddToWhitelist();
  const removeFromWhitelist = useRemoveFromWhitelist();
  
  const joinVoice = useJoinVoice();
  const playMusic = usePlayMusic();
  const pauseMusic = usePauseMusic();
  const stopMusic = useStopMusic();
  const changeUsername = useChangeUsername();
  const changeNickname = useChangeNickname();

  useEffect(() => {
    const anotherAccountIsConnected = accountSummaries.some((account) => account.state.connected);
    if (!stateLoading && accountsLoaded && botState && !botState.connected && !anotherAccountIsConnected) {
      setLocation("/login");
    }
  }, [accountSummaries, accountsLoaded, botState, stateLoading, setLocation]);

  const [customText, setCustomText] = useState("");
  useEffect(() => {
    if (botState) {
      setCustomText(botState.customText || "");
      if (botState.activityType) {
        setActivityType(botState.activityType as any);
        setActivitySongTitle(botState.activitySongTitle || "");
        setActivityArtist(botState.activityArtist || "");
        setActivityAlbum(botState.activityAlbum || "");
        setActivityImageUrl(botState.activityImageUrl || "");
        setActivityTwitchId(
          botState.activityTwitchId ||
            (botState.activityType === "streaming" ? "1098046431" : ""),
        );
        
        if (botState.activityType !== "none" && botState.activityType !== "spotify") {
           setActivityGame(botState.activitySongTitle || ""); 
        }
      }
    }
  }, [botState]);

  const handleApplyActivity = () => {
    const data: any = { type: activityType };
    if (activityType === "spotify") {
      data.songTitle = activitySongTitle;
      data.artist = activityArtist;
      data.album = activityAlbum;
      data.imageUrl = activityImageUrl;
    } else if (activityType !== "none") {
      data.songTitle = activityGame;
      data.imageUrl = activityImageUrl;
      if (activityType === "streaming") {
        data.twitchId = activityTwitchId || "1098046431";
      }
    }

    setActivity.mutate({ data }, {
      onSuccess: () => {
        toast({ title: "Activity Updated" });
        queryClient.invalidateQueries({ queryKey: getGetBotStateQueryKey() });
      },
      onError: () => {
        toast({ title: "Failed to update activity", variant: "destructive" });
      }
    });
  };

  const handleClearActivity = () => {
    setActivityType("none");
    setActivitySongTitle("");
    setActivityArtist("");
    setActivityAlbum("");
    setActivityImageUrl("");
    setActivityTwitchId("");
    setActivityGame("");
    setActivity.mutate({ data: { type: "none" } }, {
      onSuccess: () => {
        toast({ title: "Activity Cleared" });
        queryClient.invalidateQueries({ queryKey: getGetBotStateQueryKey() });
      }
    });
  };

  const handleSendMassDm = () => {
    if (!massDmMessage) return;
    sendMassDm.mutate({ data: { message: massDmMessage } }, {
      onSuccess: (res) => {
        setMassDmResult(res as any);
        setMassDmMessage("");
        toast({ title: "Mass DM Sent", description: `Sent: ${res.sent} | Failed: ${res.failed}` });
        queryClient.invalidateQueries({ queryKey: getGetBotStateQueryKey() });
      },
      onError: () => {
        toast({ title: "Failed to send Mass DM", variant: "destructive" });
      }
    });
  };

  const [joinGuildId, setJoinGuildId] = useState("");
  const [joinChannelId, setJoinChannelId] = useState("");
  const [voiceAccountIds, setVoiceAccountIds] = useState<AccountId[]>([...ACCOUNT_IDS]);
  const [joinAllPending, setJoinAllPending] = useState(false);
  const [musicQuery, setMusicQuery] = useState("");

  const [newUsername, setNewUsername] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [nickGuildId, setNickGuildId] = useState("");
  const [newNickname, setNewNickname] = useState("");

  const [activityType, setActivityType] = useState<"none" | "spotify" | "playing" | "watching" | "streaming" | "competing">("none");
  const [activitySongTitle, setActivitySongTitle] = useState("");
  const [activityArtist, setActivityArtist] = useState("");
  const [activityAlbum, setActivityAlbum] = useState("");
  const [activityImageUrl, setActivityImageUrl] = useState("");
  const [activityTwitchId, setActivityTwitchId] = useState("1098046431");
  const [activityGame, setActivityGame] = useState("");
  const [albumArtMode, setAlbumArtMode] = useState<"url" | "file">("url");
  const albumArtFileRef = useRef<HTMLInputElement>(null);

  const handleAlbumArtFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setActivityImageUrl(ev.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const [massDmMessage, setMassDmMessage] = useState("");
  const [massDmResult, setMassDmResult] = useState<{
    sent: number;
    failed: number;
    total: number;
    details: { userId: string; label: string; success: boolean; error?: string }[];
  } | null>(null);

  const [autoreactTargetUserId, setAutoreactTargetUserId] = useState("");
  const [autoreactEmojiId, setAutoreactEmojiId] = useState("");
  const [autoreactChannelId, setAutoreactChannelId] = useState("");
  const [autoreactAccountCount, setAutoreactAccountCount] = useState("all");
  const [autoreactStatus, setAutoreactStatus] = useState<AutoreactStatus | null>(null);
  const [autoreactPending, setAutoreactPending] = useState(false);

  const setActivity = useSetActivity();
  const sendMassDm = useMassDm();


  useEffect(() => {
    let mounted = true;
    const loadAutoreactStatus = async () => {
      try {
        const response = await fetch("/api/bot/autoreact", { credentials: "same-origin" });
        if (response.ok && mounted) setAutoreactStatus(await response.json());
      } catch {
        // The dashboard can still operate if the status request is temporarily unavailable.
      }
    };
    void loadAutoreactStatus();
    const interval = window.setInterval(() => void loadAutoreactStatus(), 5000);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, []);

  const handleStartAutoreact = async () => {
    if (!autoreactTargetUserId || !autoreactEmojiId || !autoreactChannelId) return;
    setAutoreactPending(true);
    try {
      const response = await fetch("/api/bot/autoreact", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          targetUserId: autoreactTargetUserId.trim(),
          emojiId: autoreactEmojiId.trim(),
          channelId: autoreactChannelId.trim(),
          accountCount: autoreactAccountCount,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Could not start autoreact");
      setAutoreactStatus(payload);
      toast({ title: "Autoreact started", description: "Watching the selected channel with " + payload.accountIds.length + " account(s)." });
    } catch (error) {
      toast({ title: error instanceof Error ? error.message : "Could not start autoreact", variant: "destructive" });
    } finally {
      setAutoreactPending(false);
    }
  };

  const handleStopAutoreact = async () => {
    setAutoreactPending(true);
    try {
      const response = await fetch("/api/bot/autoreact", { method: "DELETE", credentials: "same-origin" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Could not stop autoreact");
      setAutoreactStatus(payload);
      toast({ title: "Autoreact stopped" });
    } catch (error) {
      toast({ title: error instanceof Error ? error.message : "Could not stop autoreact", variant: "destructive" });
    } finally {
      setAutoreactPending(false);
    }
  };

  const handleDisconnect = () => {
    disconnectBot.mutate(undefined, {
      onSuccess: () => {
        toast({ title: "Disconnected" });
        queryClient.invalidateQueries({ queryKey: getGetBotStateQueryKey() });
        setLocation("/login");
      }
    });
  };

  const handleStatusChange = (status: "online" | "idle" | "dnd" | "invisible") => {
    setStatus.mutate({ data: { status, customText: botState?.customText } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetBotStateQueryKey() });
        toast({ title: "Status Updated", description: `Changed status to ${status}` });
      }
    });
  };

  const handleCustomTextSave = () => {
    if (!botState) return;
    setStatus.mutate({ data: { status: botState.status, customText } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetBotStateQueryKey() });
        toast({ title: "Custom Status Updated" });
      }
    });
  };

  const whitelistSchema = z.object({
    userId: z.string().min(1, "User ID is required"),
    label: z.string().min(1, "Label is required")
  });

  const whitelistForm = useForm<z.infer<typeof whitelistSchema>>({
    resolver: zodResolver(whitelistSchema),
    defaultValues: { userId: "", label: "" }
  });

  const onAddWhitelist = (values: z.infer<typeof whitelistSchema>) => {
    addToWhitelist.mutate({ data: values }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetWhitelistQueryKey() });
        whitelistForm.reset();
        toast({ title: "Added to Whitelist" });
      }
    });
  };

  const onRemoveWhitelist = (id: string) => {
    removeFromWhitelist.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetWhitelistQueryKey() });
        toast({ title: "Removed from Whitelist" });
      }
    });
  };

  const handleJoinVoice = () => {
    if (!joinGuildId || !joinChannelId) return;
    joinVoice.mutate({ data: { guildId: joinGuildId, channelId: joinChannelId } }, {
      onSuccess: () => {
        toast({ title: "Joined Voice Channel" });
        queryClient.invalidateQueries({ queryKey: getGetVoiceStateQueryKey() });
      },
      onError: () => {
        toast({ title: "Failed to Join", variant: "destructive" });
      }
    });
  };

  const handleJoinAllVoice = async () => {
    const connectedAccountIds = voiceAccountIds.filter((accountId) =>
      accountSummaries.some((account) => account.id === accountId && account.state.connected),
    );
    if (!joinGuildId || !joinChannelId || connectedAccountIds.length === 0) return;

    setJoinAllPending(true);
    try {
      const response = await fetch("/api/voice/join-all", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          guildId: joinGuildId,
          channelId: joinChannelId,
          accountIds: connectedAccountIds,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to join selected accounts");
      }
      const failed = payload?.failed ?? 0;
      toast({
        title: failed === 0 ? "All selected accounts joined" : "Some accounts could not join",
        description: `${payload?.joined ?? 0} joined · ${failed} failed`,
        variant: failed === 0 ? undefined : "destructive",
      });
      queryClient.invalidateQueries();
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : "Failed to join selected accounts",
        variant: "destructive",
      });
    } finally {
      setJoinAllPending(false);
    }
  };

  const handlePlayMusic = () => {
    if (!musicQuery) return;
    playMusic.mutate({ data: { query: musicQuery } }, {
      onSuccess: () => {
        toast({ title: "Added to queue" });
        setMusicQuery("");
        queryClient.invalidateQueries({ queryKey: getGetVoiceStateQueryKey() });
      },
      onError: () => {
        toast({ title: "Failed to Play", variant: "destructive" });
      }
    });
  };

  const handlePauseMusic = () => {
    pauseMusic.mutate(undefined, {
      onSuccess: () => {
        toast({ title: voiceState?.paused ? "Resumed Music" : "Paused Music" });
        queryClient.invalidateQueries({ queryKey: getGetVoiceStateQueryKey() });
      }
    });
  };

  const handleStopMusic = () => {
    stopMusic.mutate(undefined, {
      onSuccess: () => {
        toast({ title: "Stopped Music" });
        queryClient.invalidateQueries({ queryKey: getGetVoiceStateQueryKey() });
      }
    });
  };

  const handleChangeUsername = () => {
    if (!newUsername || !accountPassword) return;
    changeUsername.mutate({ data: { username: newUsername, password: accountPassword } }, {
      onSuccess: () => {
        toast({ title: "Username Changed" });
        setNewUsername("");
        setAccountPassword("");
        queryClient.invalidateQueries({ queryKey: getGetBotStateQueryKey() });
      },
      onError: () => {
        toast({ title: "Failed to Change Username", variant: "destructive" });
      }
    });
  };

  const handleChangeNickname = () => {
    if (!nickGuildId || !newNickname) return;
    changeNickname.mutate({ data: { guildId: nickGuildId, nickname: newNickname } }, {
      onSuccess: () => {
        toast({ title: "Nickname Changed" });
        setNewNickname("");
        queryClient.invalidateQueries({ queryKey: getGetGuildsQueryKey() });
      },
      onError: () => {
        toast({ title: "Failed to Change Nickname", variant: "destructive" });
      }
    });
  };

  if (stateLoading || !botState) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-5xl mx-auto space-y-6">
          <Skeleton className="h-32 w-full rounded-xl" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Skeleton className="h-64 w-full rounded-xl" />
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  const statusColorMap = {
    online: "text-green-500",
    idle: "text-yellow-500",
    dnd: "text-red-500",
    invisible: "text-gray-500",
  };

  const StatusIcon = {
    online: Circle,
    idle: Moon,
    dnd: MinusCircle,
    invisible: EyeOff,
  }[botState.status] || Circle;

  return (
    <div className="min-h-screen bg-background p-4 md:p-8 font-mono">
      <div className="max-w-5xl mx-auto space-y-6">
        
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">Active account</p>
            <p className="text-sm text-foreground">Switching accounts keeps presence, whitelist, profile, and voice controls separate.</p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={activeAccountId} onValueChange={(value) => switchAccount(value as AccountId)}>
              <SelectTrigger className="w-40 h-10"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ACCOUNT_IDS.map((accountId) => {
                  const account = accountSummaries.find((item) => item.id === accountId);
                  return <SelectItem key={accountId} value={accountId}>{account?.label || `Account ${ACCOUNT_IDS.indexOf(accountId) + 1}`}{account?.state.connected ? " · " + (account.state.username || "connected") : " · offline"}</SelectItem>;
                })}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => setLocation("/login")}>Manage accounts</Button>
          </div>
        </div>

        {/* Header / Identity */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card border border-border p-6 rounded-xl shadow-lg">
          <div className="flex items-center gap-6">
            <div className="relative">
              <Avatar className="w-20 h-20 border-2 border-border shadow-md">
                <AvatarImage src={botState.avatarUrl || undefined} />
                <AvatarFallback className="text-xl">{botState.username?.charAt(0) || "?"}</AvatarFallback>
              </Avatar>
              <div className={`absolute bottom-0 right-0 w-5 h-5 rounded-full border-4 border-card bg-background flex items-center justify-center`}>
                <StatusIcon className={`w-full h-full ${statusColorMap[botState.status] || "text-gray-500"}`} fill="currentColor" />
              </div>
            </div>
            <div>
              <h2 className="text-2xl font-bold tracking-tight">
                {botState.username}<span className="text-muted-foreground text-lg">#{botState.discriminator}</span>
              </h2>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline" className="bg-secondary/50 font-mono text-xs text-muted-foreground rounded-sm">
                  ID: {botState.userId}
                </Badge>
                {botState.connected && (
                  <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20 font-mono text-xs rounded-sm">
                    CONNECTED
                  </Badge>
                )}
              </div>
            </div>
          </div>
          <Button variant="destructive" size="sm" onClick={handleDisconnect} className="shrink-0 uppercase tracking-widest text-xs h-10 px-6">
            <LogOut className="w-4 h-4 mr-2" />
            Disconnect
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Left Column */}
          <div className="lg:col-span-5 space-y-6">
            
            {/* Rich Presence Controller */}
            <Card className="border-border bg-card shadow-md">
              <CardHeader className="pb-4">
                <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2 text-muted-foreground">
                  <Activity className="w-4 h-4" />
                  Rich Presence / Activity
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                
                <div className="space-y-3">
                  <Label className="text-xs uppercase text-muted-foreground">Status Setting</Label>
                  <Tabs value={botState.status} onValueChange={(v) => handleStatusChange(v as any)} className="w-full">
                    <TabsList className="w-full grid grid-cols-4 bg-background border border-border h-11 p-1">
                      <TabsTrigger value="online" className="data-[state=active]:bg-card text-xs">ON</TabsTrigger>
                      <TabsTrigger value="idle" className="data-[state=active]:bg-card text-xs">IDL</TabsTrigger>
                      <TabsTrigger value="dnd" className="data-[state=active]:bg-card text-xs">DND</TabsTrigger>
                      <TabsTrigger value="invisible" className="data-[state=active]:bg-card text-xs">INV</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>

                <div className="space-y-3">
                  <Label className="text-xs uppercase text-muted-foreground">Custom Status</Label>
                  <div className="flex gap-2">
                    <Input 
                      value={customText} 
                      onChange={(e) => setCustomText(e.target.value)} 
                      placeholder="Playing God..."
                      className="bg-background font-sans"
                    />
                    <Button size="icon" onClick={handleCustomTextSave} disabled={setStatus.isPending}>
                      <Save className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-3 pt-2">
                  <Label className="text-xs uppercase text-muted-foreground">Activity Type</Label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { id: "none", label: "None", icon: Circle },
                      { id: "spotify", label: "Spotify", icon: Music2 },
                      { id: "playing", label: "Playing", icon: Gamepad2 },
                      { id: "watching", label: "Watching", icon: Tv },
                      { id: "streaming", label: "Streaming", icon: MonitorPlay },
                      { id: "competing", label: "Competing", icon: Swords },
                    ].map((type) => {
                      const isActive = activityType === type.id;
                      const isSpotify = type.id === "spotify";
                      const Icon = type.icon;
                      
                      return (
                        <Button
                          key={type.id}
                          variant={isActive ? "default" : "outline"}
                          size="sm"
                          onClick={() => setActivityType(type.id as any)}
                          className={`
                            h-8 text-xs px-3 border border-border bg-background hover:bg-secondary/50 text-foreground
                            ${isActive && !isSpotify ? "!bg-primary !text-primary-foreground border-transparent" : ""}
                            ${isSpotify && isActive ? "!bg-[#1db954]/20 !text-[#1db954] !border-[#1db954]" : ""}
                            ${isSpotify && !isActive ? "hover:!text-[#1db954] hover:!border-[#1db954]/50" : ""}
                          `}
                        >
                          <Icon className={`w-3 h-3 mr-2 ${isSpotify && isActive ? "text-[#1db954]" : ""}`} />
                          {type.label}
                        </Button>
                      );
                    })}
                  </div>
                </div>

                {activityType === "spotify" && (
                  <div className="space-y-4 pt-2">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className="text-[10px] uppercase text-muted-foreground">Song Title</Label>
                        <Input value={activitySongTitle} onChange={e => setActivitySongTitle(e.target.value)} className="h-8 text-sm" placeholder="Song title..." />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-[10px] uppercase text-muted-foreground">Artist</Label>
                        <Input value={activityArtist} onChange={e => setActivityArtist(e.target.value)} className="h-8 text-sm" placeholder="Artist name..." />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-[10px] uppercase text-muted-foreground">Album</Label>
                        <Input value={activityAlbum} onChange={e => setActivityAlbum(e.target.value)} className="h-8 text-sm" placeholder="Album name..." />
                      </div>
                      <div className="space-y-2 col-span-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-[10px] uppercase text-muted-foreground">Album Art</Label>
                          <div className="flex gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant={albumArtMode === "url" ? "default" : "outline"}
                              className="h-6 text-[10px] px-2"
                              onClick={() => setAlbumArtMode("url")}
                            >
                              <Link className="w-3 h-3 mr-1" /> URL
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant={albumArtMode === "file" ? "default" : "outline"}
                              className="h-6 text-[10px] px-2"
                              onClick={() => { setAlbumArtMode("file"); albumArtFileRef.current?.click(); }}
                            >
                              <ImagePlus className="w-3 h-3 mr-1" /> Gallery
                            </Button>
                          </div>
                        </div>
                        <input
                          ref={albumArtFileRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleAlbumArtFile}
                        />
                        {albumArtMode === "url" ? (
                          <Input
                            value={activityImageUrl}
                            onChange={e => setActivityImageUrl(e.target.value)}
                            className="h-8 text-sm"
                            placeholder="https://..."
                          />
                        ) : (
                          <div
                            className="h-8 flex items-center gap-2 px-3 rounded-md border border-border bg-background cursor-pointer text-xs text-muted-foreground hover:border-primary/50 transition-colors"
                            onClick={() => albumArtFileRef.current?.click()}
                          >
                            <ImagePlus className="w-3 h-3 shrink-0" />
                            {activityImageUrl.startsWith("data:") ? "Image selected ✓" : "Tap to pick from gallery"}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Live Preview */}
                    <div className="p-4 rounded-xl border border-[#1db954]/30 bg-[#0f2318] flex items-center gap-4 relative overflow-hidden">
                      <div className="w-16 h-16 rounded-md overflow-hidden bg-[#1db954]/10 shrink-0 border border-[#1db954]/20 flex items-center justify-center">
                        {activityImageUrl ? (
                          <img src={activityImageUrl} alt="Album Art" className="w-full h-full object-cover" />
                        ) : (
                          <Music2 className="w-8 h-8 text-[#1db954]/50" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0 font-sans z-10">
                        <h4 className="font-bold text-base truncate text-white leading-tight">
                          {activitySongTitle || "Song Title"}
                        </h4>
                        <p className="text-sm text-gray-300 truncate">
                          by {activityArtist || "Artist"} — {activityAlbum || "Album"}
                        </p>
                        <p className="text-[10px] uppercase tracking-wider text-[#1db954] mt-1 font-bold">
                          Listening to Spotify
                        </p>
                      </div>
                      <div className="absolute right-0 top-0 bottom-0 w-32 bg-gradient-to-l from-[#0f2318] to-transparent pointer-events-none" />
                    </div>
                  </div>
                )}

                 {activityType !== "none" && activityType !== "spotify" && (
                  <div className="space-y-3 pt-2">
                    <Label className="text-xs uppercase text-muted-foreground">
                      {activityType === "playing" ? "Game Name" : 
                       activityType === "watching" ? "Watching" : 
                       activityType === "streaming" ? "Stream Title" : "Tournament"}
                    </Label>
                    <Input value={activityGame} onChange={e => setActivityGame(e.target.value)} className="font-sans" placeholder="Enter activity detail..." />
                     {activityType === "streaming" && (
                        <div className="space-y-4 pt-1">
                          <div className="space-y-2">
                            <Label className="text-[10px] uppercase text-muted-foreground">Twitch ID</Label>
                            <Input
                              value={activityTwitchId}
                              onChange={e => setActivityTwitchId(e.target.value)}
                              className="font-sans"
                              placeholder="channel name or Twitch ID"
                            />
                          </div>

                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <Label className="text-[10px] uppercase text-muted-foreground">Stream Image</Label>
                              <div className="flex gap-1">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant={albumArtMode === "url" ? "default" : "outline"}
                                  className="h-6 text-[10px] px-2"
                                  onClick={() => setAlbumArtMode("url")}
                                >
                                  <Link className="w-3 h-3 mr-1" /> URL
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant={albumArtMode === "file" ? "default" : "outline"}
                                  className="h-6 text-[10px] px-2"
                                  onClick={() => { setAlbumArtMode("file"); albumArtFileRef.current?.click(); }}
                                >
                                  <ImagePlus className="w-3 h-3 mr-1" /> Gallery
                                </Button>
                              </div>
                            </div>
                            {albumArtMode === "url" ? (
                              <Input
                                value={activityImageUrl}
                                onChange={e => setActivityImageUrl(e.target.value)}
                                className="h-8 text-sm"
                                placeholder="https://..."
                              />
                            ) : (
                              <div
                                className="h-8 flex items-center gap-2 px-3 rounded-md border border-border bg-background cursor-pointer text-xs text-muted-foreground hover:border-primary/50 transition-colors"
                                onClick={() => albumArtFileRef.current?.click()}
                              >
                                <ImagePlus className="w-3 h-3 shrink-0" />
                                {activityImageUrl.startsWith("data:") ? "Image selected ✓" : "Tap to pick from gallery"}
                              </div>
                            )}
                          </div>

                          <div className="p-4 rounded-xl border border-[#9146ff]/30 bg-[#1d1233] flex items-center gap-4 relative overflow-hidden">
                            <div className="w-16 h-16 rounded-md overflow-hidden bg-[#9146ff]/10 shrink-0 border border-[#9146ff]/20 flex items-center justify-center">
                              {activityImageUrl ? (
                                <img src={activityImageUrl} alt="Stream artwork" className="w-full h-full object-cover" />
                              ) : (
                                <MonitorPlay className="w-8 h-8 text-[#9146ff]/60" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0 font-sans z-10">
                              <h4 className="font-bold text-base truncate text-white leading-tight">
                                {activityGame || "Stream title"}
                              </h4>
                              <p className="text-sm text-gray-300 truncate">
                                twitch.tv/{activityTwitchId || "1098046431"}
                              </p>
                              <p className="text-[10px] uppercase tracking-wider text-[#b98cff] mt-1 font-bold">
                                Streaming on Twitch
                              </p>
                            </div>
                            <div className="absolute right-0 top-0 bottom-0 w-32 bg-gradient-to-l from-[#1d1233] to-transparent pointer-events-none" />
                          </div>
                       </div>
                     )}
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  <Button 
                    className="flex-1 uppercase text-xs tracking-wider" 
                    onClick={handleApplyActivity} 
                    disabled={setActivity.isPending || activityType === "none"}
                  >
                    <Save className="w-4 h-4 mr-2" />
                    Apply Activity
                  </Button>
                  <Button 
                    variant="outline" 
                    className="shrink-0 uppercase text-xs tracking-wider border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive" 
                    onClick={handleClearActivity}
                    disabled={setActivity.isPending}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Clear
                  </Button>
                </div>

              </CardContent>
            </Card>

          </div>

          {/* Right Column - Whitelist */}
          <div className="lg:col-span-7">
            <Card className="border-border bg-card shadow-md h-full flex flex-col">
              <CardHeader className="pb-4">
                <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2 text-muted-foreground">
                  <Users className="w-4 h-4" />
                  Trusted Whitelist
                </CardTitle>
                <CardDescription className="text-xs font-mono">
                   Users who can receive controlled bulk messages.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col gap-6">
                
                <Form {...whitelistForm}>
                  <form onSubmit={whitelistForm.handleSubmit(onAddWhitelist)} className="flex items-start gap-2 p-4 bg-background rounded-lg border border-border">
                    <FormField
                      control={whitelistForm.control}
                      name="userId"
                      render={({ field }) => (
                        <FormItem className="flex-1 space-y-1">
                          <FormControl>
                            <Input placeholder="User ID" className="h-9 font-mono text-sm bg-transparent border-none shadow-none focus-visible:ring-0 px-2" {...field} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <div className="w-px h-9 bg-border shrink-0" />
                    <FormField
                      control={whitelistForm.control}
                      name="label"
                      render={({ field }) => (
                        <FormItem className="flex-1 space-y-1">
                          <FormControl>
                            <Input placeholder="Label (e.g. Admin)" className="h-9 font-mono text-sm bg-transparent border-none shadow-none focus-visible:ring-0 px-2" {...field} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <Button type="submit" size="icon" className="shrink-0 h-9 w-9" disabled={addToWhitelist.isPending}>
                      <Plus className="w-4 h-4" />
                    </Button>
                  </form>
                </Form>

                <div className="flex-1 bg-background rounded-lg border border-border overflow-hidden">
                  {whitelistLoading ? (
                    <div className="p-4 space-y-3">
                      <Skeleton className="h-12 w-full" />
                      <Skeleton className="h-12 w-full" />
                    </div>
                  ) : whitelist.length === 0 ? (
                    <div className="h-full min-h-[200px] flex flex-col items-center justify-center text-muted-foreground">
                      <Users className="w-8 h-8 mb-2 opacity-20" />
                      <p className="text-sm">No trusted users configured</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-border">
                      {whitelist.map((entry) => (
                        <div key={entry.id} className="flex items-center justify-between p-3 hover:bg-secondary/20 transition-colors group">
                          <div>
                            <p className="font-medium text-sm font-sans">{entry.label}</p>
                            <p className="text-xs text-muted-foreground font-mono">{entry.userId}</p>
                          </div>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
                            onClick={() => onRemoveWhitelist(entry.id)}
                            disabled={removeFromWhitelist.isPending}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

              </CardContent>
            </Card>

            {/* Mass DM Section */}
            <Card className="border-border bg-card shadow-md mt-6">
              <CardHeader className="pb-4">
                <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2 text-muted-foreground">
                  <Send className="w-4 h-4" />
                  Mass DM
                </CardTitle>
                <CardDescription className="text-xs font-mono text-amber-500/80">
                  <AlertTriangle className="w-3 h-3 inline mr-1" />
                  This sends a DM to every user on your whitelist. Use carefully.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Textarea 
                  value={massDmMessage}
                  onChange={e => setMassDmMessage(e.target.value)}
                  placeholder="Message to send to all whitelisted users..."
                  className="min-h-[100px] resize-none bg-background font-sans"
                />
                <Button 
                  className="w-full uppercase text-xs tracking-wider" 
                  onClick={handleSendMassDm} 
                  disabled={sendMassDm.isPending || !massDmMessage || whitelist.length === 0}
                >
                  <Send className="w-4 h-4 mr-2" />
                  Send to All Whitelisted ({whitelist.length})
                </Button>

                {massDmResult && (
                  <div className="p-4 bg-background border border-border rounded-lg space-y-3 mt-4">
                    <div className="flex justify-between items-center text-xs font-mono uppercase">
                      <span className="text-muted-foreground">Results</span>
                      <span className="text-primary">
                        Sent: <span className="text-green-500">{massDmResult.sent}</span> | 
                        Failed: <span className="text-red-500">{massDmResult.failed}</span> | 
                        Total: {massDmResult.total}
                      </span>
                    </div>
                    <div className="space-y-2 max-h-[200px] overflow-y-auto">
                      {massDmResult.details.map((detail, i) => (
                        <div key={i} className="flex items-center justify-between text-xs p-2 rounded bg-secondary/30">
                          <span className="font-sans font-medium">{detail.label} <span className="text-muted-foreground font-mono ml-1">{detail.userId}</span></span>
                          {detail.success ? (
                            <CheckCircle className="w-4 h-4 text-green-500" />
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="text-red-500/80 truncate max-w-[150px]">{detail.error}</span>
                              <XCircle className="w-4 h-4 text-red-500" />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

          </div>

        </div>

        <Card className="border-border bg-card shadow-md mb-6">
          <CardHeader className="pb-4">
            <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2 text-muted-foreground">
              <Zap className="w-4 h-4" />
              Autoreact
              {autoreactStatus?.active && <Badge variant="outline" className="ml-auto text-green-500 border-green-500/30">ACTIVE</Badge>}
            </CardTitle>
            <CardDescription className="text-xs font-mono">
              React to a user&apos;s messages in one channel using the connected accounts you choose.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="space-y-2">
                <Label className="text-[10px] uppercase text-muted-foreground">Target user ID</Label>
                <Input value={autoreactTargetUserId} onChange={e => setAutoreactTargetUserId(e.target.value)} placeholder="123456789012345678" className="font-mono text-sm" />
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] uppercase text-muted-foreground">Emoji</Label>
                <Input value={autoreactEmojiId} onChange={e => setAutoreactEmojiId(e.target.value)} placeholder="😀, emoji ID, or <:name:id>" className="font-mono text-sm" />
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] uppercase text-muted-foreground">Channel ID</Label>
                <Input value={autoreactChannelId} onChange={e => setAutoreactChannelId(e.target.value)} placeholder="123456789012345678" className="font-mono text-sm" />
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] uppercase text-muted-foreground">Accounts</Label>
                <Select value={autoreactAccountCount} onValueChange={setAutoreactAccountCount}>
                  <SelectTrigger className="font-sans"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All connected</SelectItem>
                    {ACCOUNT_IDS.map((_, index) => <SelectItem key={index + 1} value={String(index + 1)}>{index + 1} account{index === 0 ? "" : "s"}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button onClick={() => void handleStartAutoreact()} disabled={autoreactPending || !autoreactTargetUserId || !autoreactEmojiId || !autoreactChannelId} className="flex-1 uppercase text-xs tracking-wider">
                <Zap className="w-4 h-4 mr-2" />
                {autoreactPending ? "Updating..." : "Start autoreact"}
              </Button>
              <Button variant="outline" onClick={() => void handleStopAutoreact()} disabled={autoreactPending || !autoreactStatus?.active} className="sm:w-40 uppercase text-xs tracking-wider">
                Stop
              </Button>
            </div>
            {autoreactStatus?.active && (
              <div className="rounded-lg border border-green-500/20 bg-green-500/5 px-3 py-2 text-xs font-mono text-muted-foreground space-y-1">
                <div>
                  Active for {autoreactStatus.targetLabel || autoreactStatus.targetUserId} in channel {autoreactStatus.channelId} · {autoreactStatus.accountIds.length} account(s) · {autoreactStatus.emojiId}
                </div>
                {autoreactStatus.stats && (
                  <div>
                    {autoreactStatus.stats.reacted}/{autoreactStatus.stats.matched} reacted
                    {autoreactStatus.stats.failed > 0 ? " · " + autoreactStatus.stats.failed + " failed" : ""}
                    {autoreactStatus.stats.lastError ? " · Last error: " + autoreactStatus.stats.lastError : ""}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Music Player & Profile Sections */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Music Player */}
          <div className="lg:col-span-6 space-y-6">
            <Card className="border-border bg-card shadow-md">
              <CardHeader className="pb-4">
                <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2 text-muted-foreground">
                  <Music className="w-4 h-4" />
                  Music Player
                </CardTitle>
                <CardDescription className="text-xs font-mono">
                  Control audio playback in a voice channel.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                
                {/* Join Voice */}
                <div className="space-y-3 p-4 bg-background border border-border rounded-lg">
                  <Label className="text-xs uppercase text-muted-foreground flex items-center gap-1"><Mic className="w-3 h-3" /> Voice Channel</Label>
                  <div className="flex flex-col gap-3">
                    <Select value={joinGuildId} onValueChange={setJoinGuildId}>
                      <SelectTrigger className="w-full h-9 font-sans text-sm">
                        <SelectValue placeholder="Select Guild" />
                      </SelectTrigger>
                      <SelectContent>
                        {guilds.map(g => (
                          <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex gap-2">
                      <Input
                        value={joinChannelId}
                        onChange={e => setJoinChannelId(e.target.value)}
                        placeholder="Voice Channel ID"
                        className="h-9 font-mono text-sm bg-transparent"
                      />
                      <Button onClick={handleJoinVoice} disabled={joinVoice.isPending || !joinGuildId || !joinChannelId} className="h-9 px-4 shrink-0 uppercase text-xs tracking-wider">
                        Join active
                      </Button>
                    </div>
                    <div className="space-y-2 rounded-md border border-border/70 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Join simultaneously</Label>
                        <span className="text-[10px] text-muted-foreground">
                          {voiceAccountIds.filter((accountId) => accountSummaries.some((account) => account.id === accountId && account.state.connected)).length} selected
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {accountSummaries.map((account) => {
                          const checked = voiceAccountIds.includes(account.id);
                          return (
                            <label key={account.id} className={`flex items-center gap-2 rounded border px-2 py-1.5 text-xs ${account.state.connected ? "cursor-pointer border-border" : "cursor-not-allowed border-border/40 opacity-50"}`}>
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={!account.state.connected}
                                onChange={() => setVoiceAccountIds((current) => checked ? current.filter((id) => id !== account.id) : [...current, account.id])}
                                className="accent-primary"
                              />
                              <span className="truncate">{account.label}</span>
                              <span className="ml-auto text-[10px] text-muted-foreground">{account.state.connected ? "ready" : "offline"}</span>
                            </label>
                          );
                        })}
                      </div>
                      <Button onClick={() => void handleJoinAllVoice()} disabled={joinAllPending || !joinGuildId || !joinChannelId || !voiceAccountIds.some((accountId) => accountSummaries.some((account) => account.id === accountId && account.state.connected))} className="w-full h-9 uppercase text-xs tracking-wider">
                        {joinAllPending ? "Joining selected accounts..." : "Join selected accounts together"}
                      </Button>
                    </div>
                  </div>
                  {voiceState?.inVoice && (
                    <div className="mt-2 text-xs text-green-500 font-mono flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                      Connected to {voiceState.channelName || voiceState.channelId}
                    </div>
                  )}
                </div>

                {/* Now Playing & Search */}
                <div className="space-y-4">
                  <div className="p-4 bg-background border border-border rounded-lg space-y-3">
                    <Label className="text-xs uppercase text-muted-foreground">Now Playing</Label>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-md bg-secondary/50 flex items-center justify-center shrink-0">
                        <Music className={`w-5 h-5 text-muted-foreground ${voiceState?.currentTrackTitle && !voiceState?.paused ? "animate-pulse text-primary" : ""}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium font-sans truncate">
                          {voiceState?.currentTrackTitle || "Nothing playing"}
                        </p>
                        {voiceState?.paused && <p className="text-xs text-muted-foreground font-mono">PAUSED</p>}
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Input 
                      value={musicQuery}
                      onChange={e => setMusicQuery(e.target.value)}
                      placeholder="YouTube URL or search query..."
                      className="bg-background font-sans"
                    />
                    <Button onClick={handlePlayMusic} disabled={playMusic.isPending || !musicQuery} size="icon" className="shrink-0">
                      <Play className="w-4 h-4" />
                    </Button>
                  </div>
                  
                  {voiceState?.inVoice && (
                    <div className="flex items-center gap-2 pt-2">
                      <Button variant="outline" size="sm" onClick={handlePauseMusic} disabled={pauseMusic.isPending} className="flex-1 uppercase text-xs tracking-wider">
                        {voiceState.paused ? <Play className="w-4 h-4 mr-2" /> : <Pause className="w-4 h-4 mr-2" />}
                        {voiceState.paused ? "Resume" : "Pause"}
                      </Button>
                      <Button variant="destructive" size="sm" onClick={handleStopMusic} disabled={stopMusic.isPending} className="flex-1 uppercase text-xs tracking-wider">
                        <Square className="w-4 h-4 mr-2" />
                        Stop
                      </Button>
                    </div>
                  )}
                </div>

              </CardContent>
            </Card>
          </div>

          {/* Profile Section */}
          <div className="lg:col-span-6 space-y-6">
            <Card className="border-border bg-card shadow-md">
              <CardHeader className="pb-4">
                <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2 text-muted-foreground">
                  <UserCircle className="w-4 h-4" />
                  Profile Configuration
                </CardTitle>
                <CardDescription className="text-xs font-mono">
                  Modify the selfbot's identity and global details.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                
                {/* Username */}
                <div className="space-y-4 p-4 bg-background border border-border rounded-lg">
                  <div className="flex items-start justify-between gap-4">
                    <Label className="text-xs uppercase text-muted-foreground shrink-0 mt-1">Username</Label>
                    <div className="flex items-center gap-1 text-[10px] text-amber-500/80 uppercase font-mono">
                      <AlertTriangle className="w-3 h-3" /> Max 2 changes/hour
                    </div>
                  </div>
                  <div className="space-y-3">
                    <Input
                      value={newUsername}
                      onChange={e => setNewUsername(e.target.value)}
                      placeholder="New Username"
                      className="font-sans"
                    />
                    <Input
                      type="password"
                      value={accountPassword}
                      onChange={e => setAccountPassword(e.target.value)}
                      placeholder="Account Password — required by Discord"
                      className="font-sans"
                    />
                    <Button onClick={handleChangeUsername} disabled={changeUsername.isPending || !newUsername || !accountPassword} className="w-full uppercase text-xs tracking-wider">
                      Change Username
                    </Button>
                  </div>
                </div>

                {/* Nickname */}
                <div className="space-y-4 p-4 bg-background border border-border rounded-lg">
                  <Label className="text-xs uppercase text-muted-foreground">Guild Nickname</Label>
                  <div className="space-y-3">
                    <Select value={nickGuildId} onValueChange={setNickGuildId}>
                      <SelectTrigger className="w-full h-10 font-sans text-sm">
                        <SelectValue placeholder="Select Guild" />
                      </SelectTrigger>
                      <SelectContent>
                        {guilds.map(g => (
                          <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex gap-2">
                      <Input
                        value={newNickname}
                        onChange={e => setNewNickname(e.target.value)}
                        placeholder="New Nickname"
                        className="font-sans"
                      />
                      <Button onClick={handleChangeNickname} disabled={changeNickname.isPending || !nickGuildId || !newNickname} className="shrink-0 uppercase text-xs tracking-wider px-6">
                        Apply
                      </Button>
                    </div>
                  </div>
                </div>

              </CardContent>
            </Card>
          </div>

        </div>
      </div>
    </div>
  );
}
