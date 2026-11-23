// Live studio signaling: small room/peer/event store for browser WebRTC guests.
// Hosts authenticate with ADMIN_PASSWORD; guests only need a random room id and their own random peer token.
import { getStore } from "@edgeone/pages-blob";
import { randomBytes, timingSafeEqual } from "node:crypto";

const store = getStore({ name: "archive", consistency: "strong" });
const ID_RE = /^[a-f0-9]{12}$/, TOKEN_RE = /^[a-f0-9]{32}$/, SFX = ["applause", "ding", "whoosh", "drumroll", "bell"];
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const clip = (value, n) => String(value == null ? "" : value).replace(/\u0000/g, "").slice(0, n).trim();
const same = (a, b) => { const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || "")); return x.length === y.length && timingSafeEqual(x, y); };
const roomKey = id => `live/rooms/${id}.json`;
const eventsKey = id => `live/rooms/${id}/events.json`;
const peersPrefix = id => `live/rooms/${id}/peers/`;
const peerKey = (id, token) => peersPrefix(id) + token + ".json";
const publicRoom = room => ({ id: room.id, title: room.title, status: room.status, host: room.host, createdAt: room.createdAt, question: room.question || "", timer: room.timer || { running: false, seconds: 0 }, control: room.control || "idle" });
const roomOf = async id => {
  if (!ID_RE.test(id)) return null;
  const room = await store.get(roomKey(id), { type: "json" }).catch(() => null);
  if (!room || room.status !== "live" || Date.now() > Date.parse(room.expiresAt)) return null;
  return room;
};
const peersOf = async id => {
  const { blobs } = await store.list({ prefix: peersPrefix(id), consistency: "strong" });
  return (await Promise.all(blobs.slice(0, 30).map(item => store.get(item.key, { type: "json", consistency: "strong" }).catch(() => null)))).filter(Boolean);
};
const eventCursor = async id => { const log = await store.get(eventsKey(id), { type: "json" }).catch(() => null); return log && log.next ? log.next - 1 : 0; };
async function addEvent(id, event) {
  const key = eventsKey(id), data = (await store.get(key, { type: "json" }).catch(() => null)) || { next: 1, items: [] };
  const item = { ...event, seq: data.next++, at: new Date().toISOString() };
  data.items = [...data.items, item].slice(-400);
  await store.setJSON(key, data);
  return item;
}

export async function handle(context) {
  const { request } = context, env = context.env || {};
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let b;
  try { b = await request.json(); } catch { return json({ error: "Bad JSON" }, 400); }
  const action = String(b.action || ""), id = String(b.room || "");
  const host = () => !!env.ADMIN_PASSWORD && same(request.headers.get("x-admin-password"), env.ADMIN_PASSWORD);

  if (action === "create") {
    if (!host()) return json({ error: "Wrong password" }, 401);
    const roomId = randomBytes(6).toString("hex"), now = new Date().toISOString();
    const room = { id: roomId, title: clip(b.title, 120) || "Agastya Archive Live", host: { name: clip(b.by && b.by.name, 40) || "Host", role: "Host" },
      status: "live", createdAt: now, expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(), question: "", timer: { running: false, seconds: 0 }, control: "idle" };
    await store.setJSON(roomKey(roomId), room);
    return json({ room: publicRoom(room), guestPath: "/guest.html?room=" + roomId });
  }

  const room = await roomOf(id);
  if (!room) return json({ error: "This live room has ended or the link is incorrect." }, 404);

  if (action === "join") {
    const name = clip(b.name, 40);
    if (!name) return json({ error: "Enter your name first." }, 400);
    let token = String(b.token || "");
    if (!TOKEN_RE.test(token)) token = randomBytes(16).toString("hex");
    let peer = await store.get(peerKey(id, token), { type: "json" }).catch(() => null);
    if (peer && peer.room !== id) peer = null;
    if (!peer) {
      if ((await peersOf(id)).length >= 8) return json({ error: "This room is full (8 guests maximum)." }, 403);
      peer = { id: token, room: id, name, joinedAt: new Date().toISOString() };
    }
    peer.name = name;peer.lastSeen = new Date().toISOString();
    await store.setJSON(peerKey(id, token), peer);
    await addEvent(id, { type: "join", from: token, name });
    return json({ room: publicRoom(room), peer: { id: token, name }, since: await eventCursor(id) });
  }

  if (action === "poll" || action === "signal" || action === "chat" || action === "leave") {
    const isHostCall = host(), HOST_TOKEN = "0".repeat(32);
    let token = String(b.peer || b.from || "");
    if (isHostCall) token = HOST_TOKEN;
    if (!TOKEN_RE.test(token)) return json({ error: "Bad guest token" }, 400);
    let peer = isHostCall ? { id: token, room: id, name: room.host.name } : await store.get(peerKey(id, token), { type: "json" }).catch(() => null);
    if (!peer || peer.room !== id) return json({ error: "Join the room again." }, 403);
    if (!isHostCall) peer.lastSeen = new Date().toISOString();
    if (action === "leave") {
      await store.delete(peerKey(id, token)).catch(() => {});
      await addEvent(id, { type: "leave", from: token, name: peer.name });
      return json({ ok: true });
    }
    if (action === "signal") {
      const to = String(b.to || ""), data = b.data;
      if (!TOKEN_RE.test(to)) return json({ error: "Bad signal target" }, 400);
      if (JSON.stringify(data || {}).length > 20000) return json({ error: "Signal is too large" }, 400);
      const type = data && data.type;
      if (!["offer", "answer", "candidate", "bye"].includes(type)) return json({ error: "Bad signal type" }, 400);
      await addEvent(id, { type: "signal", from: token, to, data });
      return json({ ok: true });
    }
    if (action === "chat") {
      const text = clip(b.text, 1000);
      if (!text) return json({ error: "Write a message first." }, 400);
      await addEvent(id, { type: "chat", from: token, name: peer.name, text, question: !!b.question });
      return json({ ok: true });
    }
    const since = Math.max(0, Math.floor(Number(b.since) || 0));
    const [peers, log] = await Promise.all([peersOf(id), store.get(eventsKey(id), { type: "json" }).catch(() => null)]);
    await store.setJSON(peerKey(id, token), peer);
    const events = (log && Array.isArray(log.items) ? log.items : []).filter(event => event.seq > since);
    return json({ room: publicRoom(room), peers: peers.map(item => ({ id: item.id, name: item.name, joinedAt: item.joinedAt })), events, since: Math.max(since, log && log.next ? log.next - 1 : 0) });
  }

  if (!host()) return json({ error: "Wrong password" }, 401);
  if (action === "state") return json({ ok: true, room: publicRoom(room), peers: await peersOf(id) });
  if (action === "sfx") {
    const sfx = String(b.sfx || "");
    if (!SFX.includes(sfx)) return json({ error: "Unknown sound effect" }, 400);
    await addEvent(id, { type: "sfx", sfx });
    return json({ ok: true });
  }
  if (action === "question") {
    room.question = clip(b.text, 500);room.updatedAt = new Date().toISOString();
    await store.setJSON(roomKey(id), room);
    await addEvent(id, { type: "question", text: room.question });
    return json({ ok: true });
  }
  if (action === "timer") {
    room.timer = { running: !!b.running, seconds: Math.max(0, Math.min(4 * 3600, Math.floor(Number(b.seconds) || 0))) };
    await store.setJSON(roomKey(id), room);
    await addEvent(id, { type: "timer", ...room.timer });
    return json({ ok: true });
  }
  if (action === "control") {
    const state = String(b.state || "");
    if (!["idle", "recording", "paused", "stopped"].includes(state)) return json({ error: "Bad recording state" }, 400);
    room.control = state;
    await store.setJSON(roomKey(id), room);
    await addEvent(id, { type: "control", state });
    return json({ ok: true });
  }
  if (action === "end") {
    room.status = "ended";room.updatedAt = new Date().toISOString();
    await store.setJSON(roomKey(id), room);
    await addEvent(id, { type: "end" });
    return json({ ok: true });
  }
  return json({ error: "Unknown live action" }, 400);
}

export async function onRequest(context) {
  try { return await handle(context); }
  catch (e) { return json({ error: "Server error: " + (e && e.message || e) }, 500); }
}
