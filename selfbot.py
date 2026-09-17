#!/usr/bin/env python3
"""
Discord Selfbot Controller — Termux Edition
Run: python selfbot.py
Then open http://localhost:5000 in your browser.

Install deps first:
    pip install discord.py-self flask flask-cors requests
    pip install yt-dlp  # optional, for music info
"""

import threading
import base64
import json
import os
import time
import uuid
import asyncio
from concurrent.futures import TimeoutError as FutureTimeoutError
from flask import Flask, request, jsonify, render_template_string
from flask_cors import CORS

try:
    import discord
    from discord.ext import tasks
    DISCORD_AVAILABLE = True
except ImportError:
    DISCORD_AVAILABLE = False
    print("[WARN] discord.py-self not installed. Run: pip install discord.py-self")

# ─── State ────────────────────────────────────────────────────────────────────

DEFAULT_TWITCH_ID = "1098046431"

bot_state = {
    "connected": False,
    "username": None,
    "discriminator": None,
    "avatarUrl": None,
    "userId": None,
    "status": "online",
    "customText": None,
    "statusStreamTitle": None,
    "statusTwitchId": DEFAULT_TWITCH_ID,
    "activityType": "none",
    "activitySongTitle": None,
    "activityArtist": None,
    "activityAlbum": None,
    "activityImageUrl": None,
}

whitelist = []  # list of {id, userId, label, addedAt}

client_instance = None
client_thread = None
loop = None

# ─── Discord Client ────────────────────────────────────────────────────────────

def make_client():
    if not DISCORD_AVAILABLE:
        raise RuntimeError("discord.py-self not installed")

    intents = discord.Intents.default()
    intents.message_content = True
    intents.messages = True
    intents.dm_messages = True

    client = discord.Client(self_bot=True)

    @client.event
    async def on_ready():
        global bot_state
        user = client.user
        bot_state.update({
            "connected": True,
            "username": user.name,
            "discriminator": user.discriminator,
            "avatarUrl": str(user.avatar.url) if user.avatar else None,
            "userId": str(user.id),
        })
        print(f"[BOT] Logged in as {user.name}#{user.discriminator}")
        await apply_presence(client)

    return client


async def apply_presence(client):
    if not client or not client.is_ready():
        return

    status_map = {
        "online": discord.Status.online,
        "idle": discord.Status.idle,
        "dnd": discord.Status.dnd,
        "invisible": discord.Status.invisible,
    }
    is_streaming_status = bot_state["status"] == "streaming"
    status = discord.Status.online if is_streaming_status else status_map.get(
        bot_state["status"], discord.Status.online
    )

    atype = bot_state["activityType"]
    activity = None

    if is_streaming_status:
        twitch_id = (bot_state.get("statusTwitchId") or "").strip()
        stream_title = (bot_state.get("statusStreamTitle") or "Twitch").strip()
        activity = discord.Streaming(
            name=stream_title,
            url=f"https://twitch.tv/{twitch_id or DEFAULT_TWITCH_ID}",
        )
    elif atype == "spotify":
        song = bot_state["activitySongTitle"] or "Unknown Song"
        artist = bot_state["activityArtist"] or "Unknown Artist"
        album = bot_state["activityAlbum"] or ""
        activity = discord.Activity(
            type=discord.ActivityType.listening,
            name="Spotify",
            details=song,
            state=f"by {artist}",
            assets={
                "large_image": bot_state["activityImageUrl"] or "spotify:ab67616d0000b2731",
                "large_text": album,
                "small_image": "spotify:ab6775700000ee85d",
                "small_text": "Spotify",
            },
        )
    elif atype == "playing":
        activity = discord.Game(name=bot_state["activitySongTitle"] or "a game")
    elif atype == "watching":
        activity = discord.Activity(
            type=discord.ActivityType.watching,
            name=bot_state["activitySongTitle"] or "something",
        )
    elif atype == "competing":
        activity = discord.Activity(
            type=discord.ActivityType.competing,
            name=bot_state["activitySongTitle"] or "a tournament",
        )
    elif bot_state["customText"]:
        activity = discord.CustomActivity(name=bot_state["customText"])

    try:
        await client.change_presence(status=status, activity=activity)
        print(f"[BOT] Presence set: {status} / {bot_state['status']} / {atype}")
    except Exception as e:
        print(f"[BOT] Presence error: {e}")

def run_client(token):
    global client_instance, loop
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    client_instance = make_client()
    try:
        loop.run_until_complete(client_instance.start(token))
    except Exception as e:
        print(f"[BOT] Client error: {e}")
        bot_state["connected"] = False
        client_instance = None


def stop_client():
    global client_instance, client_thread, loop
    if client_instance and loop:
        future = asyncio.run_coroutine_threadsafe(client_instance.close(), loop)
        try:
            future.result(timeout=5)
        except Exception:
            pass
    client_instance = None
    client_thread = None
    loop = None


# ─── Flask App ─────────────────────────────────────────────────────────────────

app = Flask(__name__)
CORS(app)


@app.route("/api/bot/state")
def get_state():
    return jsonify(bot_state)


@app.route("/api/bot/connect", methods=["POST"])
def connect():
    global client_thread
    data = request.json or {}
    token = data.get("token", "").strip()
    if not token:
        return jsonify({"error": "Token is required"}), 400
    if bot_state["connected"]:
        stop_client()
        time.sleep(1)
    bot_state.update({"connected": False, "username": None, "userId": None})
    client_thread = threading.Thread(target=run_client, args=(token,), daemon=True)
    client_thread.start()
    # Wait up to 15s for connection
    for _ in range(30):
        time.sleep(0.5)
        if bot_state["connected"]:
            return jsonify(bot_state)
    return jsonify({"error": "Connection timed out. Check your token."}), 400


@app.route("/api/bot/disconnect", methods=["POST"])
def disconnect():
    stop_client()
    bot_state.update({
        "connected": False, "username": None, "discriminator": None,
        "avatarUrl": None, "userId": None,
    })
    return jsonify(bot_state)


@app.route("/api/bot/status", methods=["POST"])
def set_status():
    if not bot_state["connected"]:
        return jsonify({"error": "Bot not connected"}), 400
    data = request.json or {}
    bot_state["status"] = data.get("status", "online")
    bot_state["customText"] = data.get("customText")
    if bot_state["status"] == "streaming":
        bot_state["statusStreamTitle"] = (data.get("streamTitle") or "Twitch").strip()
        bot_state["statusTwitchId"] = (data.get("twitchId") or "").strip() or DEFAULT_TWITCH_ID
    if client_instance and loop:
        try:
            asyncio.run_coroutine_threadsafe(apply_presence(client_instance), loop).result(timeout=10)
        except FutureTimeoutError:
            return jsonify({"error": "Presence update timed out"}), 504
        except Exception as exc:
            return jsonify({"error": "Presence update failed", "message": str(exc)}), 400
    return jsonify(bot_state)


@app.route("/api/bot/activity", methods=["POST"])
def set_activity():
    if not bot_state["connected"]:
        return jsonify({"error": "Bot not connected"}), 400
    data = request.json or {}
    bot_state["activityType"] = data.get("type", "none")
    bot_state["activitySongTitle"] = data.get("songTitle")
    bot_state["activityArtist"] = data.get("artist")
    bot_state["activityAlbum"] = data.get("album")
    bot_state["activityImageUrl"] = data.get("imageUrl")
    if client_instance and loop:
        try:
            asyncio.run_coroutine_threadsafe(apply_presence(client_instance), loop).result(timeout=10)
        except FutureTimeoutError:
            return jsonify({"error": "Presence update timed out"}), 504
        except Exception as exc:
            return jsonify({"error": "Presence update failed", "message": str(exc)}), 400
    return jsonify(bot_state)


@app.route("/api/bot/mass-dm", methods=["POST"])
def mass_dm():
    if not bot_state["connected"]:
        return jsonify({"error": "Bot not connected"}), 400
    data = request.json or {}
    message_text = data.get("message", "").strip()
    if not message_text:
        return jsonify({"error": "Message is required"}), 400
    if not whitelist:
        return jsonify({"error": "Whitelist is empty"}), 400

    results = []

    async def send_dms():
        for entry in whitelist:
            uid = int(entry["userId"])
            try:
                user = await client_instance.fetch_user(uid)
                dm = await user.create_dm()
                await dm.send(message_text)
                results.append({"userId": entry["userId"], "label": entry["label"], "success": True, "error": None})
                await asyncio.sleep(1)
            except Exception as e:
                results.append({"userId": entry["userId"], "label": entry["label"], "success": False, "error": str(e)})

    if client_instance and loop:
        future = asyncio.run_coroutine_threadsafe(send_dms(), loop)
        future.result(timeout=60)

    sent = sum(1 for r in results if r["success"])
    return jsonify({"sent": sent, "failed": len(results) - sent, "total": len(results), "details": results})


@app.route("/api/whitelist", methods=["GET"])
def get_whitelist():
    return jsonify(whitelist)


@app.route("/api/whitelist", methods=["POST"])
def add_whitelist():
    data = request.json or {}
    user_id = data.get("userId", "").strip()
    label = data.get("label", "").strip()
    if not user_id or not label:
        return jsonify({"error": "userId and label are required"}), 400
    entry = {"id": str(uuid.uuid4()), "userId": user_id, "label": label, "addedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ")}
    whitelist.append(entry)
    return jsonify(entry), 201


@app.route("/api/whitelist/<entry_id>", methods=["DELETE"])
def remove_whitelist(entry_id):
    global whitelist
    before = len(whitelist)
    whitelist = [w for w in whitelist if w["id"] != entry_id]
    if len(whitelist) == before:
        return jsonify({"error": "Not found"}), 404
    return jsonify({"error": "Removed"})


@app.route("/api/profile/guilds")
def get_guilds():
    if not client_instance or not bot_state["connected"]:
        return jsonify([])
    guilds = [{"id": str(g.id), "name": g.name, "iconUrl": str(g.icon.url) if g.icon else None, "memberCount": g.member_count} for g in client_instance.guilds]
    return jsonify(guilds)


@app.route("/api/profile/username", methods=["POST"])
def change_username():
    if not bot_state["connected"]:
        return jsonify({"error": "Bot not connected"}), 400
    data = request.json or {}
    username = data.get("username", "").strip()
    password = data.get("password", "").strip()
    if not username or not password:
        return jsonify({"error": "Username and password are required"}), 400

    async def do_edit():
        await client_instance.user.edit(username=username, password=password)
        bot_state["username"] = client_instance.user.name

    if client_instance and loop:
        try:
            future = asyncio.run_coroutine_threadsafe(do_edit(), loop)
            future.result(timeout=10)
            return jsonify(bot_state)
        except Exception as e:
            return jsonify({"error": "Failed", "message": str(e)}), 400
    return jsonify({"error": "Client unavailable"}), 400


@app.route("/api/profile/nickname", methods=["POST"])
def change_nickname():
    if not bot_state["connected"]:
        return jsonify({"error": "Bot not connected"}), 400
    data = request.json or {}
    guild_id = data.get("guildId", "").strip()
    nickname = data.get("nickname", "")
    if not guild_id:
        return jsonify({"error": "guildId is required"}), 400

    async def do_nick():
        guild = client_instance.get_guild(int(guild_id))
        if not guild:
            raise ValueError("Guild not found")
        me = guild.me
        await me.edit(nick=nickname or None)

    if client_instance and loop:
        try:
            future = asyncio.run_coroutine_threadsafe(do_nick(), loop)
            future.result(timeout=10)
            return jsonify({"error": "Nickname updated"})
        except Exception as e:
            return jsonify({"error": "Failed", "message": str(e)}), 400
    return jsonify({"error": "Client unavailable"}), 400


@app.route("/api/profile/avatar", methods=["POST"])
def change_avatar():
    if not bot_state["connected"]:
        return jsonify({"error": "Bot not connected"}), 400
    data = request.json or {}
    image_data = (data.get("imageData") or "").strip()
    password = (data.get("password") or "").strip()
    if not image_data:
        return jsonify({"error": "imageData is required"}), 400
    if "," in image_data and image_data.startswith("data:"):
        image_data = image_data.split(",", 1)[1]
    try:
        avatar_bytes = base64.b64decode(image_data)
    except Exception:
        return jsonify({"error": "Invalid image data"}), 400
    if len(avatar_bytes) > 8 * 1024 * 1024:
        return jsonify({"error": "Image too large (max 8MB)"}), 400

    async def do_avatar():
        kwargs = {"avatar": avatar_bytes}
        if password:
            kwargs["password"] = password
        await client_instance.user.edit(**kwargs)
        user = client_instance.user
        bot_state["avatarUrl"] = str(user.avatar.url) if user.avatar else None

    if client_instance and loop:
        try:
            asyncio.run_coroutine_threadsafe(do_avatar(), loop).result(timeout=20)
            return jsonify(bot_state)
        except Exception as e:
            return jsonify({"error": "Failed", "message": str(e)}), 400
    return jsonify({"error": "Client unavailable"}), 400


# ─── Web UI ────────────────────────────────────────────────────────────────────

HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Discord Selfbot Controller</title>
<style>
  :root {
    --bg: #0d0e10; --surface: #1a1c1f; --card: #22252a;
    --border: #2e3136; --accent: #5865F2; --accent2: #4752c4;
    --text: #e3e5e8; --muted: #72767d; --green: #57f287;
    --yellow: #fee75c; --red: #ed4245; --spotify: #1db954;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: 'Segoe UI', system-ui, sans-serif; min-height: 100vh; }
  .container { max-width: 860px; margin: 0 auto; padding: 20px 16px; }
  h1 { font-size: 1.4rem; font-weight: 700; color: var(--accent); letter-spacing: 0.05em; margin-bottom: 4px; }
  .subtitle { color: var(--muted); font-size: 0.8rem; margin-bottom: 24px; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 18px; margin-bottom: 16px; }
  .card-title { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); margin-bottom: 14px; display: flex; align-items: center; gap: 8px; }
  label { display: block; font-size: 0.75rem; font-weight: 600; color: var(--muted); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.05em; }
  input, textarea, select { width: 100%; background: var(--surface); border: 1px solid var(--border); color: var(--text); padding: 9px 12px; border-radius: 6px; font-size: 0.9rem; outline: none; font-family: inherit; }
  input:focus, textarea:focus, select:focus { border-color: var(--accent); }
  textarea { resize: vertical; min-height: 70px; }
  .btn { display: inline-flex; align-items: center; gap: 6px; padding: 9px 18px; border-radius: 6px; font-weight: 600; font-size: 0.85rem; cursor: pointer; border: none; transition: filter 0.15s; }
  .btn:hover { filter: brightness(1.15); }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-primary { background: var(--accent); color: #fff; }
  .btn-danger { background: var(--red); color: #fff; }
  .btn-success { background: var(--green); color: #000; }
  .btn-spotify { background: var(--spotify); color: #fff; }
  .btn-ghost { background: var(--surface); border: 1px solid var(--border); color: var(--text); }
  .row { display: flex; gap: 10px; flex-wrap: wrap; }
  .row .col { flex: 1; min-width: 160px; }
  .status-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 2px; }
  .status-btn { padding: 7px 14px; border-radius: 6px; font-size: 0.8rem; font-weight: 600; cursor: pointer; border: 2px solid transparent; transition: all 0.15s; background: var(--surface); color: var(--muted); }
  .status-btn.active { border-color: currentColor; }
  .status-btn.online { color: var(--green); }
  .status-btn.idle { color: var(--yellow); }
  .status-btn.dnd { color: var(--red); }
  .status-btn.invisible { color: var(--muted); }
  .status-btn.streaming { color: #9147ff; }
  .badge { display: inline-block; padding: 3px 8px; border-radius: 20px; font-size: 0.7rem; font-weight: 700; }
  .badge-online { background: #2d4a33; color: var(--green); }
  .badge-offline { background: #3a2020; color: var(--red); }
  .profile-row { display: flex; align-items: center; gap: 14px; }
  .avatar { width: 52px; height: 52px; border-radius: 50%; object-fit: cover; border: 2px solid var(--border); }
  .avatar-placeholder { width: 52px; height: 52px; border-radius: 50%; background: var(--surface); border: 2px solid var(--border); display: flex; align-items: center; justify-content: center; color: var(--muted); font-size: 1.3rem; }
  .profile-info .name { font-weight: 700; font-size: 1rem; }
  .profile-info .tag { color: var(--muted); font-size: 0.8rem; }
  .whitelist-item { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--border); }
  .whitelist-item:last-child { border-bottom: none; }
  .whitelist-item .info { flex: 1; }
  .whitelist-item .label { font-weight: 600; font-size: 0.9rem; }
  .whitelist-item .uid { font-size: 0.75rem; color: var(--muted); font-family: monospace; }
  .dm-result { font-size: 0.8rem; margin-top: 10px; padding: 10px; background: var(--surface); border-radius: 6px; }
  .toggle { display: flex; align-items: center; gap: 10px; }
  .toggle input[type=checkbox] { width: 36px; height: 20px; appearance: none; background: var(--border); border-radius: 20px; cursor: pointer; position: relative; transition: background 0.2s; }
  .toggle input[type=checkbox]:checked { background: var(--accent); }
  .toggle input[type=checkbox]::after { content: ''; position: absolute; left: 3px; top: 3px; width: 14px; height: 14px; background: white; border-radius: 50%; transition: left 0.2s; }
  .toggle input[type=checkbox]:checked::after { left: 19px; }
  .tab-row { display: flex; gap: 4px; margin-bottom: 14px; }
  .tab { padding: 6px 14px; border-radius: 6px; font-size: 0.8rem; font-weight: 600; cursor: pointer; border: none; background: var(--surface); color: var(--muted); }
  .tab.active { background: var(--accent); color: #fff; }
  .section { display: none; }
  .section.active { display: block; }
  .toast { position: fixed; bottom: 20px; right: 20px; background: var(--card); border: 1px solid var(--border); padding: 12px 18px; border-radius: 8px; font-size: 0.85rem; z-index: 999; animation: slide-in 0.2s ease; max-width: 300px; }
  .toast.success { border-color: var(--green); color: var(--green); }
  .toast.error { border-color: var(--red); color: var(--red); }
  @keyframes slide-in { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
  .warn { background: #2a1f0f; border: 1px solid #5a3a0f; color: #f0a040; padding: 10px 14px; border-radius: 8px; font-size: 0.8rem; margin-bottom: 16px; }
  .mb { margin-bottom: 12px; }
  .spotify-preview { background: #0f2318; border: 1px solid #1db954; border-radius: 8px; padding: 12px; margin-top: 10px; display: none; }
  .spotify-preview.show { display: flex; gap: 12px; align-items: center; }
  .spotify-preview img { width: 52px; height: 52px; border-radius: 6px; object-fit: cover; background: #1a3326; }
  .spotify-preview .track { font-weight: 600; font-size: 0.9rem; }
  .spotify-preview .meta { font-size: 0.75rem; color: #1db954; }
</style>
</head>
<body>
<div class="container">
  <h1>&#9881; Discord Selfbot Controller</h1>
  <p class="subtitle">Termux Edition — all controls in one page</p>

  <div class="warn">
    This tool uses a Discord user token (selfbot). This violates Discord's ToS and may result in an account ban. Use at your own risk.
  </div>

  <!-- Login -->
  <div class="card" id="login-card">
    <div class="card-title">&#128273; Authentication</div>
    <div class="mb">
      <label>USER TOKEN</label>
      <input type="password" id="token-input" placeholder="Paste your Discord user token..." />
    </div>
    <button class="btn btn-primary" onclick="connect()">Connect</button>
  </div>

  <!-- Connected Profile -->
  <div class="card" id="profile-card" style="display:none">
    <div class="profile-row">
      <div id="avatar-wrap" class="avatar-placeholder">?</div>
      <div class="profile-info">
        <div class="name" id="profile-name">Unknown</div>
        <div class="tag" id="profile-tag">#0000</div>
        <div style="margin-top:4px">
          <span class="badge badge-online" id="conn-badge">CONNECTED</span>
        </div>
      </div>
      <div style="margin-left:auto">
        <button class="btn btn-danger" onclick="disconnect()">Disconnect</button>
      </div>
    </div>
  </div>

  <!-- Tabs -->
  <div id="controls" style="display:none">
    <div class="tab-row">
      <button class="tab active" onclick="showTab('status')">Status</button>
      <button class="tab" onclick="showTab('activity')">Activity</button>
      <button class="tab" onclick="showTab('whitelist')">Whitelist</button>
      <button class="tab" onclick="showTab('profile')">Profile</button>
    </div>

    <!-- Status Tab -->
    <div class="section active" id="tab-status">
      <div class="card">
        <div class="card-title">&#127775; Presence Status</div>
        <div class="status-row">
          <button class="status-btn online" onclick="setStatus('online')">Online</button>
          <button class="status-btn idle" onclick="setStatus('idle')">Idle</button>
          <button class="status-btn dnd" onclick="setStatus('dnd')">Do Not Disturb</button>
          <button class="status-btn invisible" onclick="setStatus('invisible')">Invisible</button>
          <button class="status-btn streaming" onclick="setStatus('streaming')">Streaming</button>
        </div>
        <div id="streaming-status-fields" style="display:none; margin-top:14px">
          <div class="mb">
            <label>STREAM TITLE</label>
            <input type="text" id="status-stream-title" placeholder="What are you streaming?" />
          </div>
          <div class="mb">
            <label>TWITCH CHANNEL</label>
            <input type="text" id="status-twitch-id" value="1098046431" placeholder="your Twitch channel name" />
          </div>
          <button class="btn btn-primary" onclick="setStatus('streaming')">Update Twitch Status</button>
        </div>
        <div style="margin-top:14px">
          <label>CUSTOM STATUS TEXT</label>
          <div class="row">
            <div class="col"><input type="text" id="custom-text" placeholder="What are you up to?" /></div>
            <div><button class="btn btn-primary" onclick="setCustomText()">Save</button></div>
          </div>
        </div>
      </div>

    </div>

    <!-- Activity Tab -->
    <div class="section" id="tab-activity">
      <div class="card">
        <div class="card-title">&#127925; Rich Presence / Activity</div>
        <div class="mb">
          <label>ACTIVITY TYPE</label>
          <select id="activity-type" onchange="onActivityTypeChange()">
            <option value="none">None</option>
            <option value="spotify">Listening to Spotify</option>
            <option value="playing">Playing a Game</option>
            <option value="watching">Watching</option>
            <option value="competing">Competing</option>
          </select>
        </div>

        <div id="activity-fields">
          <div class="mb" id="field-song">
            <label id="label-song">SONG TITLE / NAME</label>
            <input type="text" id="activity-song" placeholder="Enter song or activity name..." />
          </div>
          <div id="spotify-only">
            <div class="mb">
              <label>ARTIST</label>
              <input type="text" id="activity-artist" placeholder="Artist name..." />
            </div>
            <div class="mb">
              <label>ALBUM</label>
              <input type="text" id="activity-album" placeholder="Album name..." />
            </div>
            <div class="mb">
              <label>ALBUM ART URL (optional)</label>
              <input type="text" id="activity-image" placeholder="https://... (leave blank for Spotify icon)" oninput="updateSpotifyPreview()" />
            </div>
          </div>
          <div id="spotify-preview" class="spotify-preview">
            <img id="preview-img" src="" alt="Album Art" onerror="this.src=''" />
            <div>
              <div class="track" id="preview-title">Song Title</div>
              <div class="meta" id="preview-artist">by Artist — Album</div>
              <div style="font-size:0.7rem; color: var(--muted); margin-top:2px">Listening to Spotify</div>
            </div>
          </div>
        </div>

        <button class="btn btn-spotify" onclick="setActivity()">Apply Activity</button>
        <button class="btn btn-ghost" style="margin-left:8px" onclick="clearActivity()">Clear</button>
      </div>
    </div>

    <!-- Whitelist Tab -->
    <div class="section" id="tab-whitelist">
      <div class="card">
        <div class="card-title">&#128737; Whitelist</div>
        <div class="row mb">
          <div class="col">
            <label>DISCORD USER ID</label>
            <input type="text" id="wl-userid" placeholder="123456789012345678" />
          </div>
          <div class="col">
            <label>LABEL / NAME</label>
            <input type="text" id="wl-label" placeholder="Friend's name..." />
          </div>
          <div style="align-self:flex-end">
            <button class="btn btn-primary" onclick="addWhitelist()">Add</button>
          </div>
        </div>
        <div id="whitelist-list"><div style="color:var(--muted);font-size:0.85rem">No entries yet.</div></div>
      </div>

      <div class="card">
        <div class="card-title">&#128231; Mass DM</div>
        <div class="mb">
          <label>MESSAGE TO SEND TO ALL WHITELISTED USERS</label>
          <textarea id="mass-dm-msg" placeholder="Your message..."></textarea>
        </div>
        <button class="btn btn-primary" onclick="massDm()">Send to All</button>
        <div id="dm-result" class="dm-result" style="display:none"></div>
      </div>
    </div>

    <!-- Profile Tab -->
    <div class="section" id="tab-profile">
      <div class="card">
        <div class="card-title">&#128444; Change Avatar</div>
        <div class="warn" style="margin-bottom:12px">Pick a picture from your gallery. Max 8MB. Discord may require your password.</div>
        <div class="mb">
          <label>PICTURE FROM GALLERY</label>
          <input type="file" id="avatar-file" accept="image/*" onchange="previewAvatar()" />
        </div>
        <div class="mb" id="avatar-preview-wrap" style="display:none">
          <img id="avatar-preview" class="avatar" style="width:80px;height:80px" alt="Avatar preview" />
        </div>
        <div class="mb">
          <label>ACCOUNT PASSWORD (if required)</label>
          <input type="password" id="avatar-password" placeholder="Your Discord password..." />
        </div>
        <button class="btn btn-primary" onclick="changeAvatar()">Upload Avatar</button>
      </div>

      <div class="card">
        <div class="card-title">&#128100; Change Username</div>
        <div class="warn" style="margin-bottom:12px">Discord limits username changes to 2 per hour and requires your account password.</div>
        <div class="mb">
          <label>NEW USERNAME</label>
          <input type="text" id="new-username" placeholder="newusername" />
        </div>
        <div class="mb">
          <label>ACCOUNT PASSWORD</label>
          <input type="password" id="account-password" placeholder="Your Discord password..." />
        </div>
        <button class="btn btn-primary" onclick="changeUsername()">Change Username</button>
      </div>

      <div class="card">
        <div class="card-title">&#127991; Change Server Nickname</div>
        <div class="mb">
          <label>SERVER</label>
          <select id="guild-select"><option value="">Loading servers...</option></select>
        </div>
        <div class="mb">
          <label>NICKNAME (leave blank to reset)</label>
          <input type="text" id="new-nickname" placeholder="Your nickname..." />
        </div>
        <button class="btn btn-primary" onclick="changeNickname()">Apply Nickname</button>
      </div>
    </div>
  </div>
</div>

<script>
const API = '';
let currentStatus = 'online';

function toast(msg, type = 'success') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

async function api(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(API + path, opts);
  return r.json();
}

async function connect() {
  const token = document.getElementById('token-input').value.trim();
  if (!token) return toast('Enter your token first', 'error');
  toast('Connecting...');
  const res = await api('/api/bot/connect', 'POST', { token });
  if (res.error) return toast(res.error, 'error');
  renderState(res);
  toast('Connected as ' + res.username);
  loadGuilds();
}

async function disconnect() {
  await api('/api/bot/disconnect', 'POST');
  document.getElementById('profile-card').style.display = 'none';
  document.getElementById('controls').style.display = 'none';
  document.getElementById('login-card').style.display = 'block';
  toast('Disconnected');
}

function renderState(s) {
  if (!s.connected) return;
  document.getElementById('login-card').style.display = 'none';
  document.getElementById('profile-card').style.display = 'block';
  document.getElementById('controls').style.display = 'block';
  document.getElementById('profile-name').textContent = s.username || '';
  document.getElementById('profile-tag').textContent = '#' + (s.discriminator || '0');
  const avatarWrap = document.getElementById('avatar-wrap');
  if (s.avatarUrl) {
    avatarWrap.outerHTML = `<img id="avatar-wrap" class="avatar" src="${s.avatarUrl}" />`;
  }
  if (s.customText) document.getElementById('custom-text').value = s.customText;
  if (s.statusStreamTitle) document.getElementById('status-stream-title').value = s.statusStreamTitle;
  document.getElementById('status-twitch-id').value = s.statusTwitchId || '1098046431';
  currentStatus = s.status;
  updateStreamingFields();
}

function updateStreamingFields() {
  document.getElementById('streaming-status-fields').style.display =
    currentStatus === 'streaming' ? 'block' : 'none';
}

async function setStatus(status) {
  currentStatus = status;
  updateStreamingFields();
  const customText = document.getElementById('custom-text').value;
  const body = { status, customText };
  if (status === 'streaming') {
    body.streamTitle = document.getElementById('status-stream-title').value.trim() || null;
    body.twitchId = document.getElementById('status-twitch-id').value.trim() || null;
  }
  const res = await api('/api/bot/status', 'POST', body);
  if (res.error) return toast(res.error, 'error');
  renderState(res);
  toast('Status set to ' + status);
}

async function setCustomText() {
  const customText = document.getElementById('custom-text').value;
  const body = { status: currentStatus, customText };
  if (currentStatus === 'streaming') {
    body.streamTitle = document.getElementById('status-stream-title').value.trim() || null;
    body.twitchId = document.getElementById('status-twitch-id').value.trim() || null;
  }
  const res = await api('/api/bot/status', 'POST', body);
  if (res.error) return toast(res.error, 'error');
  renderState(res);
  toast('Custom status saved');
}

function onActivityTypeChange() {
  const type = document.getElementById('activity-type').value;
  const spotifyOnly = document.getElementById('spotify-only');
  const labelSong = document.getElementById('label-song');
  const preview = document.getElementById('spotify-preview');
  spotifyOnly.style.display = type === 'spotify' ? 'block' : 'none';
  preview.style.display = type === 'spotify' ? 'flex' : 'none';
  if (type === 'spotify') { labelSong.textContent = 'SONG TITLE'; preview.classList.add('show'); }
  else if (type === 'playing') labelSong.textContent = 'GAME NAME';
  else if (type === 'watching') labelSong.textContent = 'WATCHING NAME';
  else if (type === 'competing') labelSong.textContent = 'TOURNAMENT NAME';
  else labelSong.textContent = 'NAME';
}

function updateSpotifyPreview() {
  const song = document.getElementById('activity-song').value || 'Song Title';
  const artist = document.getElementById('activity-artist').value || 'Artist';
  const album = document.getElementById('activity-album').value || '';
  const img = document.getElementById('activity-image').value;
  document.getElementById('preview-title').textContent = song;
  document.getElementById('preview-artist').textContent = 'by ' + artist + (album ? ' — ' + album : '');
  if (img) document.getElementById('preview-img').src = img;
}

async function setActivity() {
  const type = document.getElementById('activity-type').value;
  const body = {
    type,
    songTitle: document.getElementById('activity-song').value || null,
    artist: document.getElementById('activity-artist').value || null,
    album: document.getElementById('activity-album').value || null,
    imageUrl: document.getElementById('activity-image').value || null,
  };
  const res = await api('/api/bot/activity', 'POST', body);
  if (res.error) return toast(res.error, 'error');
  toast('Activity applied!');
}

async function clearActivity() {
  document.getElementById('activity-type').value = 'none';
  onActivityTypeChange();
  const res = await api('/api/bot/activity', 'POST', { type: 'none' });
  if (res.error) return toast(res.error, 'error');
  toast('Activity cleared');
}

async function addWhitelist() {
  const userId = document.getElementById('wl-userid').value.trim();
  const label = document.getElementById('wl-label').value.trim();
  if (!userId || !label) return toast('Fill in both fields', 'error');
  const res = await api('/api/whitelist', 'POST', { userId, label });
  if (res.error) return toast(res.error, 'error');
  document.getElementById('wl-userid').value = '';
  document.getElementById('wl-label').value = '';
  toast('Added to whitelist');
  loadWhitelist();
}

async function loadWhitelist() {
  const list = await api('/api/whitelist');
  const el = document.getElementById('whitelist-list');
  if (!list.length) { el.innerHTML = '<div style="color:var(--muted);font-size:0.85rem">No entries yet.</div>'; return; }
  el.innerHTML = list.map(w => `
    <div class="whitelist-item">
      <div class="info">
        <div class="label">${w.label}</div>
        <div class="uid">${w.userId}</div>
      </div>
      <button class="btn btn-danger" style="padding:6px 12px;font-size:0.75rem" onclick="removeWhitelist('${w.id}')">Remove</button>
    </div>
  `).join('');
}

async function removeWhitelist(id) {
  await api('/api/whitelist/' + id, 'DELETE');
  toast('Removed');
  loadWhitelist();
}

async function massDm() {
  const message = document.getElementById('mass-dm-msg').value.trim();
  if (!message) return toast('Enter a message', 'error');
  const resultEl = document.getElementById('dm-result');
  resultEl.style.display = 'block';
  resultEl.textContent = 'Sending...';
  const res = await api('/api/bot/mass-dm', 'POST', { message });
  if (res.error) { resultEl.textContent = 'Error: ' + res.error; return; }
  resultEl.innerHTML = `Sent: ${res.sent} | Failed: ${res.failed} | Total: ${res.total}`;
  toast(`Sent to ${res.sent}/${res.total} users`);
}

let avatarDataUrl = null;

function previewAvatar() {
  const input = document.getElementById('avatar-file');
  const file = input.files && input.files[0];
  if (!file) { avatarDataUrl = null; document.getElementById('avatar-preview-wrap').style.display = 'none'; return; }
  const reader = new FileReader();
  reader.onload = () => {
    avatarDataUrl = reader.result;
    document.getElementById('avatar-preview').src = avatarDataUrl;
    document.getElementById('avatar-preview-wrap').style.display = 'block';
  };
  reader.readAsDataURL(file);
}

async function changeAvatar() {
  if (!avatarDataUrl) return toast('Pick a picture first', 'error');
  const password = document.getElementById('avatar-password').value;
  toast('Uploading avatar...');
  const res = await api('/api/profile/avatar', 'POST', { imageData: avatarDataUrl, password });
  if (res.error) return toast(res.message || res.error, 'error');
  const wrap = document.getElementById('avatar-wrap');
  if (res.avatarUrl && wrap) wrap.outerHTML = `<img id="avatar-wrap" class="avatar" src="${res.avatarUrl}" />`;
  toast('Avatar updated!');
}

async function changeUsername() {
  const username = document.getElementById('new-username').value.trim();
  const password = document.getElementById('account-password').value;
  if (!username || !password) return toast('Fill in both fields', 'error');
  const res = await api('/api/profile/username', 'POST', { username, password });
  if (res.error) return toast(res.error, 'error');
  document.getElementById('profile-name').textContent = res.username || username;
  toast('Username changed!');
}

async function changeNickname() {
  const guildId = document.getElementById('guild-select').value;
  const nickname = document.getElementById('new-nickname').value;
  if (!guildId) return toast('Select a server', 'error');
  const res = await api('/api/profile/nickname', 'POST', { guildId, nickname });
  if (res.error && res.error !== 'Nickname updated') return toast(res.error, 'error');
  toast('Nickname updated!');
}

async function loadGuilds() {
  const guilds = await api('/api/profile/guilds');
  const sel = document.getElementById('guild-select');
  sel.innerHTML = guilds.map(g => `<option value="${g.id}">${g.name}</option>`).join('');
}

function showTab(name) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  event.target.classList.add('active');
  if (name === 'whitelist') loadWhitelist();
}

// Init: check if already connected
api('/api/bot/state').then(s => { if (s.connected) { renderState(s); loadGuilds(); loadWhitelist(); } });
onActivityTypeChange();
</script>
</body>
</html>"""


@app.route("/")
def index():
    return HTML


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"\n{'='*50}")
    print("  Discord Selfbot Controller — Termux Edition")
    print(f"{'='*50}")
    print(f"  Open in browser: http://localhost:{port}")
    print(f"  Or from your phone: http://<your-ip>:{port}")
    print(f"{'='*50}\n")
    app.run(host="0.0.0.0", port=port, debug=False)
