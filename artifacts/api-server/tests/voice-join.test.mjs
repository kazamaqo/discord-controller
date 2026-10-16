import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";

// Exercise the real command listener without Discord credentials or voice sockets.
const path = new URL("../src/lib/command-listener.ts", import.meta.url);
const source = stripTypeScriptTypes(await readFile(path, "utf8"))
  .replace(/^import .* from "\.\/(?:bot-manager|music-manager|welcomer|mention-log)";\n/gm, "");
let sequence = 0;
async function fixture({ connected = ["primary", "secondary", "account3"], fail = [] } = {}) {
  const events = [];
  const listeners = [];
  const ids = ["primary", "secondary", "account3", "account4", "account5"];
  const managers = Object.fromEntries(ids.map(id => [id, {
    getState: () => ({ connected: connected.includes(id), userId: id === "primary" ? "123456789012345" : id }),
    getClient: () => connected.includes(id) ? { id, on: (event, callback) => { if (event === "messageCreate") listeners.push(callback); } } : null,
  }]));
  const key = `__voiceJoinTest${sequence++}`;
  globalThis[key] = {
    ACCOUNT_IDS: ids,
    getBotManager: id => managers[id],
    getAccountSummaries: () => [],
    getMusicManager: id => ({ join: async (client, guild, channel) => {
      events.push({ type: "join", id, guild, channel });
      if (fail.includes(id)) throw new Error("Cannot access voice channel");
      return { channelName: "Voice" };
    } }),
    handleWelcomeMessage: () => {}, clearMentions: () => {}, mentionChunks: () => [], recordMention: () => {},
  };
  const bindings = `const { ACCOUNT_IDS, getBotManager, getAccountSummaries, getMusicManager, handleWelcomeMessage, clearMentions, mentionChunks, recordMention } = globalThis[${JSON.stringify(key)}];\n`;
  const module = await import(`data:text/javascript;base64,${Buffer.from(bindings + source).toString("base64")}#${key}`);
  delete globalThis[key];
  module.installPrimaryCommandListener();
  return {
    events,
    async command(content, { guild = "987654321098765", author = "123456789012345" } = {}) {
      const message = {
        id: `message-${sequence++}`, content, author: { id: author }, guild: guild ? { id: guild } : null,
        channel: { id: "234567890123456", send: async text => events.push({ type: "send", text }) },
        delete: async () => events.push({ type: "delete" }),
      };
      for (const callback of listeners) callback(message);
      for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve));
    },
  };
}

test("xar join infers the server containing the primary command", async () => {
  const f = await fixture();
  await f.command("xar join 345678901234567 2");
  assert.deepEqual(f.events.filter(e => e.type === "join").map(e => [e.guild, e.channel]), [
    ["987654321098765", "345678901234567"], ["987654321098765", "345678901234567"],
  ]);
});

test("the requested count selects exactly two online accounts in configured order", async () => {
  const f = await fixture({ connected: ["primary", "account3", "account5"] });
  await f.command("xar join 345678901234567 2");
  assert.deepEqual(f.events.filter(e => e.type === "join").map(e => e.id), ["primary", "account3"]);
});

test("successful voice joins send no response", async () => {
  const f = await fixture();
  await f.command("xar join 345678901234567 1");
  assert.equal(f.events.filter(e => e.type === "join").length, 1);
  assert.equal(f.events.filter(e => e.type === "send").length, 0);
});

test("the user's command is deleted before voice joins start", async () => {
  const f = await fixture();
  await f.command("xar join 345678901234567 2");
  assert.deepEqual(f.events.map(e => e.type), ["delete", "join", "join"]);
});

test("commands from other users never join or delete messages", async () => {
  const f = await fixture();
  await f.command("xar join 345678901234567 2", { author: "other-user" });
  assert.deepEqual(f.events, []);
});

test("an unavailable account count is rejected without joining a smaller amount", async () => {
  const f = await fixture({ connected: ["primary"] });
  await f.command("xar join 345678901234567 2");
  assert.equal(f.events.filter(e => e.type === "join").length, 0);
  assert.equal(f.events.filter(e => e.type === "send").length, 1);
});

test("direct messages cannot infer a server", async () => {
  const f = await fixture();
  await f.command("xar join 345678901234567 2", { guild: null });
  assert.equal(f.events.filter(e => e.type === "join").length, 0);
  assert.equal(f.events.filter(e => e.type === "send").length, 1);
});

test("invalid counts cannot trigger voice joins", async () => {
  for (const count of ["0", "-1", "1.5", "NaN", "9007199254740992"]) {
    const f = await fixture();
    await f.command(`xar join 345678901234567 ${count}`);
    assert.equal(f.events.filter(e => e.type === "join").length, 0, count);
  }
});

test("legacy xjoin vc still joins all connected accounts silently", async () => {
  const f = await fixture();
  await f.command("xjoin vc 876543210987654 345678901234567");
  assert.equal(f.events.filter(e => e.type === "join").length, 3);
  assert.ok(f.events.filter(e => e.type === "join").every(e => e.guild === "876543210987654"));
  assert.equal(f.events.filter(e => e.type === "send").length, 0);
  assert.equal(f.events[0].type, "delete");
});

test("one failed account does not stop remaining selected accounts", async () => {
  const f = await fixture({ fail: ["primary"] });
  await f.command("xar join 345678901234567 2");
  assert.deepEqual(f.events.filter(e => e.type === "join").map(e => e.id), ["primary", "secondary"]);
  assert.equal(f.events.filter(e => e.type === "send").length, 1);
});
