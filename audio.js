// GET /api/audio?id=...  -> streams an episode with HTTP Range support.
// Audio is stored as 2 MB parts, so each response is at most one part.
import { getStore } from "@edgeone/pages-blob";

const CHUNK = 2 * 1024 * 1024;

export async function onRequest({ request }) {
  const id = new URL(request.url).searchParams.get("id") || "";
  const store = getStore({ name: "archive" });
  const idx = await store.get("episodes.json", { type: "json" });
  const ep = idx && idx.episodes.find(x => x.id === id);
  if (!ep) return new Response("Not found", { status: 404 });

  const size = ep.size;
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
  const buf = await store.get(`audio/${id}/${String(ci).padStart(5, "0")}`, { type: "arrayBuffer" });
  if (!buf) return new Response("Missing audio part", { status: 404 });

  const body = buf.slice(start - ci * CHUNK, end - ci * CHUNK + 1);
  const partial = ranged || end < size - 1;
  return new Response(body, {
    status: partial ? 206 : 200,
    headers: {
      "Content-Type": ep.type || "audio/webm", "Accept-Ranges": "bytes",
      "Content-Length": String(body.byteLength), "Cache-Control": "public, max-age=86400",
      ...(partial ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
    },
  });
}