// GET /api/audio?id=...  -> streams an episode with HTTP Range support.
// Audio is stored as 2 MB parts, so each response is at most one part.
import { getStore } from "@edgeone/pages-blob";
import { timingSafeEqual } from "node:crypto";

const CHUNK = 2 * 1024 * 1024;
const same = (a, b) => { const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || "")); return x.length === y.length && timingSafeEqual(x, y); };

async function handle({ request, env }) {
  const url = new URL(request.url), id = url.searchParams.get("id") || "", draftId = url.searchParams.get("draft") || "";
  const store = getStore({ name: "archive" });
  let audio, priv = false;
  if (draftId) {
    if (!env || !env.ADMIN_PASSWORD || !same(request.headers.get("x-admin-password"), env.ADMIN_PASSWORD)) return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
    const draft = /^[a-z0-9]{6,20}$/.test(draftId) ? await store.get(`drafts/${draftId}.json`, { type: "json" }).catch(() => null) : null;
    if (!draft || !draft.audio) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
    audio = draft.audio;priv = true;
  } else {
    const idx = await store.get("episodes.json", { type: "json" });
    const ep = idx && idx.episodes.find(x => x.id === id);
    if (!ep || (ep.publishAt && Date.parse(ep.publishAt) > Date.now())) return new Response("Not found", { status: 404 });
    audio = ep;
  }
  const size = audio.size;
  let start = 0, end = size - 1, ranged = false;
  const m = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") || "");
  if (m && (m[1] || m[2])) {
    ranged = true;
    if (m[1] === "") start = Math.max(0, size - +m[2]);
    else { start = +m[1]; if (m[2] !== "") end = Math.min(end, +m[2]); }
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }
  const ci = Math.floor(start / CHUNK);
  end = Math.min(end, (ci + 1) * CHUNK - 1);
  const buf = await store.get(`audio/${audio.id}/${String(ci).padStart(5, "0")}`, { type: "arrayBuffer" });
  if (!buf) return new Response("Missing audio part", { status: 404 });

  const body = buf.slice(start - ci * CHUNK, end - ci * CHUNK + 1);
  const partial = ranged || end < size - 1;
  return new Response(body, {
    status: partial ? 206 : 200,
    headers: {
      "Content-Type": audio.type || "audio/webm", "Accept-Ranges": "bytes",
      "Content-Length": String(body.byteLength), "Cache-Control": priv ? "private, no-store" : "public, max-age=86400",
      ...(partial ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
    },
  });
}

export async function onRequest(ctx) {
  try { return await handle(ctx); }
  catch (e) { return new Response("Server error: " + (e && e.message || e), { status: 500 }); }
}
