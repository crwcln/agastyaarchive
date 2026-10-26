// GET  /api/episodes  -> public episode list
// POST /api/episodes  -> admin actions: check | upload-start | publish | delete; PUT uploads an audio part
import { getStore } from "@edgeone/pages-blob";
import { timingSafeEqual } from "node:crypto";

const CHUNK = 2 * 1024 * 1024, MAX_CHUNKS = 500;
const pad = i => String(i).padStart(5, "0");
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const same = (a, b) => { const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || "")); return x.length === y.length && timingSafeEqual(x, y); };

async function handle(context) {
  const { request } = context, env = context.env || {};
  const store = getStore({ name: "archive", consistency: "strong" });
  const load = async () => (await store.get("episodes.json", { type: "json" })) || { episodes: [] };

  if (request.method === "GET") return json(await load());
  if (request.method !== "POST" && request.method !== "PUT") return json({ error: "Method not allowed" }, 405);

  if (!env.ADMIN_PASSWORD || !same(request.headers.get("x-admin-password"), env.ADMIN_PASSWORD)) {
    await new Promise(r => setTimeout(r, 600));
    return json({ error: "Wrong password" }, 401);
  }
  if (request.method === "PUT") {
    const url = new URL(request.url), id = url.searchParams.get("id"), partText = url.searchParams.get("part"), part = Math.floor(+partText);
    if (!/^[a-z0-9]{6,20}$/.test(id || "") || partText === null || !(part >= 0 && part < MAX_CHUNKS)) return json({ error: "Bad upload part" }, 400);
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength < 1 || bytes.byteLength > CHUNK) return json({ error: "Bad upload size" }, 400);
    await store.set(`audio/${id}/${pad(part)}`, bytes);
    return json({ ok: true });
  }

  let b; try { b = await request.json(); } catch { return json({ error: "Bad JSON" }, 400); }

  if (b.action === "check") return json({ ok: true });

  if (b.action === "upload-start") {
    const n = Math.floor(+b.parts);
    if (!(n >= 1 && n <= MAX_CHUNKS)) return json({ error: "Bad part count" }, 400);
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    return json({ id });
  }

  const idx = await load();

  if (b.action === "publish") {
    const e = b.episode || {}, id = String(e.id || "");
    if (!/^[a-z0-9]{6,20}$/.test(id)) return json({ error: "Bad id" }, 400);
    const chunks = Math.floor(+e.chunks), size = Math.floor(+e.size);
    if (!(chunks >= 1 && chunks <= MAX_CHUNKS && size > (chunks - 1) * CHUNK && size <= chunks * CHUNK)) return json({ error: "Bad size" }, 400);
    const { blobs } = await store.list({ prefix: `audio/${id}/`, consistency: "strong" });
    if (blobs.length !== chunks) return json({ error: `Expected ${chunks} audio parts, found ${blobs.length}` }, 400);
    const title = String(e.title || "").trim().slice(0, 200);
    if (!title) return json({ error: "Title required" }, 400);
    const rec = {
      id, num: idx.episodes.reduce((m, x) => Math.max(m, x.num || 0), 0) + 1, title,
      unit: String(e.unit || "").slice(0, 80),
      date: /^\d{4}-\d{2}-\d{2}$/.test(e.date) ? e.date : new Date().toISOString().slice(0, 10),
      rant: Math.min(5, Math.max(1, +e.rant || 3)),
      desc: String(e.desc || "").trim().slice(0, 5000),
      size, chunks, type: /^audio\/[\w.+-]+$/.test(e.type) ? e.type : "audio/webm",
    };
    idx.episodes.push(rec);
    await store.setJSON("episodes.json", idx);
    return json({ ok: true, episode: rec });
  }

  if (b.action === "delete") {
    const id = String(b.id || "");
    if (!idx.episodes.some(x => x.id === id)) return json({ error: "Not found" }, 404);
    idx.episodes = idx.episodes.filter(x => x.id !== id);
    await store.setJSON("episodes.json", idx);
    const { blobs } = await store.list({ prefix: `audio/${id}/`, consistency: "strong" });
    for (const o of blobs) await store.delete(o.key);
    return json({ ok: true });
  }
  return json({ error: "Unknown action" }, 400);
}

export async function onRequest(context) {
  try { return await handle(context); }
  catch (e) { return json({ error: "Server error: " + (e && e.message || e) }, 500); }
}
