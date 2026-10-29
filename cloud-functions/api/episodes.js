// GET  /api/episodes  -> public episode list
// POST /api/episodes  -> admin actions: check | upload-start | publish | delete; PUT uploads an audio part
import { getStore } from "@edgeone/pages-blob";
import { createHash, timingSafeEqual } from "node:crypto";

const CHUNK = 2 * 1024 * 1024, MAX_CHUNKS = 500;
const pad = i => String(i).padStart(5, "0");
// Global reactions: one blob per visitor+reaction (reactions/v/<episode>/<reaction>/<visitor>), recounted into reactions/c/<episode>.json
const REACTIONS = ["fire", "laugh", "mindblown", "insight"];
// Host collaboration: shared ideas board and drafts (neither is ever exposed by the public GET)
const IDEA_STATUS = ["new", "discussing", "planned", "recorded", "parked"], ID_RE = /^[a-z0-9]{6,20}$/;
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const clip = (v, n) => String(v == null ? "" : v).slice(0, n);
const person = p => ({ name: clip(p && p.name, 40).trim() || "Someone", role: p && p.role === "Co-host" ? "Co-host" : "Host" });
const readAll = async (store, prefix) => {
  const { blobs } = await store.list({ prefix, consistency: "strong" });
  return (await Promise.all(blobs.map(o => store.get(o.key, { type: "json" }).catch(() => null)))).filter(Boolean);
};
const dropAudio = async (store, id) => { const { blobs } = await store.list({ prefix: `audio/${id}/`, consistency: "strong" }); for (const o of blobs) await store.delete(o.key); };
const cleanWords = words => Array.isArray(words) ? words.slice(0, 30000).map(w => ({ word: clip(w.word, 100), start: Number(w.start), end: Number(w.end) })).filter(w => w.word && Number.isFinite(w.start) && Number.isFinite(w.end) && w.start >= 0 && w.end >= w.start) : [];
const newestFirst = (a, c) => Date.parse(c.updatedAt) - Date.parse(a.updatedAt);
const reactionTotals = c => Object.fromEntries(REACTIONS.map(r => [r, Math.max(0, Number(c && c[r]) || 0)]));
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const same = (a, b) => { const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || "")); return x.length === y.length && timingSafeEqual(x, y); };
const interactionFailure = result => {
  const message = value => typeof value === "string" ? value : value && typeof value === "object" ? String(value.message || value.detail || value.description || value.reason || value.code || "") : "";
  const details = [result.error, result.error_message, result.errorMessage, result.last_error, result.lastError, result.failure_reason, result.failureReason, result.failure_details, result.status_details, result.status_message, result.message, result.details].map(message).filter(Boolean);
  for (const step of result.steps || []) {
    if (step.type !== "error" && !step.error && !step.error_code && step.status !== "failed") continue;
    const detail = message(step.error) || message(step) || (step.content || []).filter(item => item.type === "text").map(item => item.text || "").join(" ");
    if (detail) details.push(detail);
  }
  const metadata = ["model=" + String(result.model || "unknown"), "steps=" + (result.steps || []).map(step => step.type + (step.status ? ":" + step.status : "")).join(",")];
  if (result.updated) metadata.push("updated=" + result.updated);
  return ([...new Set(details)].join(" ") || "No provider error field was returned.") + " [" + metadata.join("; ") + "]";
};

async function handle(context) {
  const { request } = context, env = context.env || {};
  const store = getStore({ name: "archive", consistency: "strong" });
  const load = async () => (await store.get("episodes.json", { type: "json" })) || { episodes: [] };

  if (request.method === "GET") {
    const idx = await load(), now = Date.now();
    const episodes = idx.episodes.filter(e => !e.publishAt || Date.parse(e.publishAt) <= now);
    const counts = await Promise.all(episodes.map(e => store.get(`reactions/c/${e.id}.json`, { type: "json" }).catch(() => null)));
    return json({ episodes: episodes.map((e, i) => ({ ...e, reactions: reactionTotals(counts[i]) })) });
  }
  if (request.method !== "POST" && request.method !== "PUT") return json({ error: "Method not allowed" }, 405);

  let b;
  if (request.method === "POST") {
    try { b = await request.json(); } catch { return json({ error: "Bad JSON" }, 400); }
    if (b.action === "record-listen") {
      const id = String(b.id || ""), listener = String(b.listener || ""), localHour = Number(b.localHour);
      if (!/^[a-z0-9]{6,20}$/.test(id) || !/^[a-f0-9]{32}$/.test(listener) || !Number.isInteger(localHour) || localHour < 0 || localHour > 23) {
        return json({ error: "Bad listening event" }, 400);
      }
      const idx = await load(), episode = idx.episodes.find(item => item.id === id);
      if (!episode || (episode.publishAt && Date.parse(episode.publishAt) > Date.now())) return json({ error: "Episode not found" }, 404);
      const day = new Date().toISOString().slice(0, 10), visitorHash = createHash("sha256").update(listener).digest("hex");
      const key = `analytics/listens/${day}/${String(localHour).padStart(2, "0")}/${visitorHash}/${id}.json`;
      await store.setJSON(key, { episodeId: id, localHour, recordedAt: new Date().toISOString() });
      return json({ ok: true });
    }
    if (b.action === "react") {
      const id = String(b.id || ""), listener = String(b.listener || ""), reaction = b.reaction === null || b.reaction === "" || b.reaction === undefined ? null : String(b.reaction);
      if (!/^[a-z0-9]{6,20}$/.test(id) || !/^[a-f0-9]{32}$/.test(listener) || (reaction !== null && !REACTIONS.includes(reaction))) return json({ error: "Bad reaction" }, 400);
      const idx = await load(), episode = idx.episodes.find(item => item.id === id);
      if (!episode || (episode.publishAt && Date.parse(episode.publishAt) > Date.now())) return json({ error: "Episode not found" }, 404);
      const visitor = createHash("sha256").update("reaction|" + listener).digest("hex").slice(0, 40), keyFor = r => `reactions/v/${id}/${r}/${visitor}`;
      await Promise.all(REACTIONS.filter(r => r !== reaction).map(r => store.delete(keyFor(r)).catch(() => {})));
      if (reaction) await store.setJSON(keyFor(reaction), { at: new Date().toISOString() });
      const totals = {};
      await Promise.all(REACTIONS.map(async r => { const { blobs } = await store.list({ prefix: `reactions/v/${id}/${r}/`, consistency: "strong" }); totals[r] = blobs.length; }));
      await store.setJSON(`reactions/c/${id}.json`, totals);
      return json({ ok: true, reactions: totals, selected: reaction });
    }
  }

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

  if (b.action === "check") return json({ ok: true });

  // ---- ideas board ----
  if (b.action === "list-ideas") return json({ ideas: (await readAll(store, "ideas/")).sort(newestFirst) });
  if (b.action === "save-idea") {
    const id = b.id ? String(b.id) : newId(), key = `ideas/${id}.json`;
    if (!ID_RE.test(id)) return json({ error: "Bad idea id" }, 400);
    const old = b.id ? await store.get(key, { type: "json" }).catch(() => null) : null;
    if (b.id && !old) return json({ error: "Idea not found" }, 404);
    const title = clip(b.title !== undefined ? b.title : old && old.title, 200).trim();
    if (!title) return json({ error: "Give the idea a title." }, 400);
    const now = new Date().toISOString(), by = person(b.by);
    const idea = { id, title, notes: clip(b.notes !== undefined ? b.notes : old && old.notes, 8000).trim(),
      status: IDEA_STATUS.includes(b.status) ? b.status : (old && old.status) || "new",
      author: old ? old.author : by, createdAt: old ? old.createdAt : now, updatedAt: now, updatedBy: by, comments: old ? old.comments : [] };
    await store.setJSON(key, idea);
    return json({ ok: true, idea });
  }
  if (b.action === "comment-idea") {
    const id = String(b.id || ""), text = clip(b.text, 2000).trim();
    if (!ID_RE.test(id)) return json({ error: "Bad idea id" }, 400);
    if (!text) return json({ error: "Write a comment first." }, 400);
    const key = `ideas/${id}.json`, idea = await store.get(key, { type: "json" }).catch(() => null);
    if (!idea) return json({ error: "Idea not found" }, 404);
    if (idea.comments.length >= 300) return json({ error: "This thread is full." }, 400);
    const now = new Date().toISOString(), by = person(b.by);
    idea.comments.push({ id: newId(), author: by, text, at: now });
    idea.updatedAt = now; idea.updatedBy = by;
    await store.setJSON(key, idea);
    return json({ ok: true, idea });
  }
  if (b.action === "delete-idea") {
    const id = String(b.id || "");
    if (!ID_RE.test(id)) return json({ error: "Bad idea id" }, 400);
    await store.delete(`ideas/${id}.json`).catch(() => {});
    return json({ ok: true });
  }

  // ---- drafts: an episode in progress (text, notes, transcript and optionally audio), never public ----
  if (b.action === "list-drafts") {
    const drafts = await readAll(store, "drafts/");
    return json({ drafts: drafts.sort(newestFirst).map(d => ({ id: d.id, title: d.title, unit: d.unit, desc: clip(d.desc, 200), hasNotes: !!d.notes, ideaId: d.ideaId || null,
      audio: d.audio ? { size: d.audio.size } : null, author: d.author, updatedBy: d.updatedBy, createdAt: d.createdAt, updatedAt: d.updatedAt })) });
  }
  if (b.action === "get-draft") {
    const id = String(b.id || "");
    if (!ID_RE.test(id)) return json({ error: "Bad draft id" }, 400);
    const draft = await store.get(`drafts/${id}.json`, { type: "json" }).catch(() => null);
    return draft ? json({ draft }) : json({ error: "Draft not found" }, 404);
  }
  if (b.action === "save-draft") {
    const e = b.draft || {}, by = person(b.by), id = e.id ? String(e.id) : newId(), key = `drafts/${id}.json`;
    if (!ID_RE.test(id)) return json({ error: "Bad draft id" }, 400);
    const old = e.id ? await store.get(key, { type: "json" }).catch(() => null) : null;
    if (e.id && !old) return json({ error: "Draft not found" }, 404);
    let audio = null; // {keep:true} keeps the saved audio, null removes it, an object replaces it
    if (e.audio && e.audio.keep) audio = old ? old.audio : null;
    else if (e.audio) {
      const aid = String(e.audio.id || ""), chunks = Math.floor(+e.audio.chunks), size = Math.floor(+e.audio.size);
      if (!ID_RE.test(aid) || !(chunks >= 1 && chunks <= MAX_CHUNKS && size > (chunks - 1) * CHUNK && size <= chunks * CHUNK)) return json({ error: "Bad audio details" }, 400);
      const { blobs } = await store.list({ prefix: `audio/${aid}/`, consistency: "strong" });
      if (blobs.length !== chunks) return json({ error: `Expected ${chunks} audio parts, found ${blobs.length}` }, 400);
      audio = { id: aid, size, chunks, type: /^audio\/[\w.+-]+$/.test(e.audio.type) ? e.audio.type : "audio/webm" };
    }
    if (old && old.audio && (!audio || audio.id !== old.audio.id)) await dropAudio(store, old.audio.id); // replaced or removed
    const now = new Date().toISOString();
    const draft = { id, title: clip(e.title, 200).trim(), unit: clip(e.unit, 80), date: /^\d{4}-\d{2}-\d{2}$/.test(e.date) ? e.date : "",
      rant: Math.min(5, Math.max(1, +e.rant || 3)), desc: clip(e.desc, 5000), notes: clip(e.notes, 20000), transcript: clip(e.transcript, 200000),
      transcriptWords: cleanWords(e.transcriptWords), chapters: clip(e.chapters, 5000), whenLocal: clip(e.whenLocal, 20),
      ideaId: ID_RE.test(String(e.ideaId || "")) ? String(e.ideaId) : (old && old.ideaId) || null, audio,
      author: old ? old.author : by, createdAt: old ? old.createdAt : now, updatedAt: now, updatedBy: by };
    await store.setJSON(key, draft);
    return json({ ok: true, draft });
  }
  if (b.action === "delete-draft") {
    const id = String(b.id || "");
    if (!ID_RE.test(id)) return json({ error: "Bad draft id" }, 400);
    const draft = await store.get(`drafts/${id}.json`, { type: "json" }).catch(() => null);
    if (!draft) return json({ error: "Draft not found" }, 404);
    await store.delete(`drafts/${id}.json`);
    if (draft.audio && !b.keepAudio) await dropAudio(store, draft.audio.id); // keepAudio: the audio now belongs to a published episode
    return json({ ok: true });
  }

  if (b.action === "upload-start") {
    const n = Math.floor(+b.parts);
    if (!(n >= 1 && n <= MAX_CHUNKS)) return json({ error: "Bad part count" }, 400);
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    return json({ id });
  }

  if (b.action === "discard-upload") {
    const id = String(b.id || "");
    if (!/^[a-z0-9]{6,20}$/.test(id)) return json({ error: "Bad upload id" }, 400);
    const { blobs } = await store.list({ prefix: `audio/${id}/`, consistency: "strong" });
    for (const item of blobs) await store.delete(item.key);
    return json({ ok: true });
  }

  if (b.action === "transcribe") {
    if (!env.GEMINI_API_KEY) return json({ error: "AI is not configured. Add GEMINI_API_KEY to the cloud-function environment." }, 503);
    const id = String(b.id || ""), parts = Math.floor(+b.parts), size = Math.floor(+b.size), maxTranscribeBytes = 80 * 1024 * 1024;
    if (!/^[a-z0-9]{6,20}$/.test(id) || !(parts >= 1 && parts <= MAX_CHUNKS) || !(size > 0 && size <= maxTranscribeBytes)) return json({ error: "Audio must be between 1 byte and 80 MB to transcribe." }, 400);
    const { blobs } = await store.list({ prefix: `audio/${id}/`, consistency: "strong" });
    if (blobs.length !== parts) return json({ error: `Expected ${parts} audio parts, found ${blobs.length}` }, 400);
    const audioParts = await Promise.all(Array.from({ length: parts }, (_, i) => store.get(`audio/${id}/${pad(i)}`, { type: "arrayBuffer", consistency: "strong" })));
    if (audioParts.some(part => !part)) return json({ error: "An audio part is missing. Upload the audio again." }, 400);
    const actualSize = audioParts.reduce((total, part) => total + part.byteLength, 0);
    if (actualSize !== size) return json({ error: "Uploaded audio size does not match." }, 400);
    const mime = String(b.type || "audio/webm").split(";")[0];
    const start = await fetch("https://generativelanguage.googleapis.com/upload/v1beta/files", { method: "POST", headers: { "x-goog-api-key": env.GEMINI_API_KEY, "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start", "X-Goog-Upload-Header-Content-Length": String(size), "X-Goog-Upload-Header-Content-Type": mime, "Content-Type": "application/json" }, body: JSON.stringify({ file: { display_name: "Agastya Archive episode transcription" } }) });
    if (!start.ok) return json({ error: `Gemini file upload setup failed (HTTP ${start.status}).` }, 502);
    const uploadUrl = start.headers.get("x-goog-upload-url");
    if (!uploadUrl) return json({ error: "Gemini did not return an upload URL." }, 502);
    const audioBlob = new Blob(audioParts, { type: mime });
    const uploaded = await fetch(uploadUrl, { method: "POST", headers: { "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" }, body: audioBlob });
    let fileResult = {}; try { fileResult = await uploaded.json(); } catch {}
    if (!uploaded.ok || !fileResult.file?.uri) return json({ error: fileResult.error?.message || `Gemini file upload failed (HTTP ${uploaded.status}).` }, 502);
    const geminiFile = fileResult.file;
    try {
      const model = env.GEMINI_TRANSCRIBE_MODEL || "gemini-3.5-transcribe";
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: "POST", headers: { "x-goog-api-key": env.GEMINI_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ fileData: { fileUri: geminiFile.uri, mimeType: geminiFile.mimeType || mime } }, { text: "Transcribe the speech and include word-level timestamps. The host's name is Agastya (spelled A-g-a-s-t-y-a); use that spelling when the name is spoken." }] }], generationConfig: { audioTranscriptionConfig: { wordTimestamp: true } } }) });
      let result = {}; try { result = await response.json(); } catch {}
      if (!response.ok) return json({ error: result.error?.message || `Gemini transcription failed (HTTP ${response.status}).` }, 502);
      const candidate = result.candidates?.[0], partsOut = result.candidates?.flatMap(item => item.content?.parts || []) || [];
      const toSeconds = value => {
        if (typeof value === "number") return Number.isFinite(value) ? value : null;
        const match = String(value || "").match(/^(-?\d+(?:\.\d+)?)(ms|s)?$/i);
        if (!match) return null;
        const number = Number(match[1]); return match[2]?.toLowerCase() === "ms" ? number / 1000 : number;
      };
      const words = partsOut.flatMap(part => {
        const transcription = part.audioTranscription || part.audio_transcription;
        return (transcription?.words || []).map(item => ({ word: String(item.word || "").trim(), start: toSeconds(item.startOffset ?? item.start_offset), end: toSeconds(item.endOffset ?? item.end_offset) })).filter(item => item.word && item.start !== null && item.end !== null && item.end >= item.start);
      }).slice(0, 30000);
      const transcriptParts = partsOut.map(part => part.text || "").filter(Boolean);
      const transcript = [...transcriptParts, result.text || result.output_text || ""].join("\n").trim() || words.map(item => item.word).join(" ");
      if (!transcript) {
        const reason = candidate?.finishReason || candidate?.finish_reason || result.promptFeedback?.blockReason || result.prompt_feedback?.block_reason;
        const detail = reason && reason !== "STOP" ? ` Gemini response status: ${reason}.` : " Gemini returned neither transcript text nor word-level timing data.";
        return json({ error: `Gemini returned an empty transcript.${detail} Check that the audio contains audible speech and is in a supported audio format.` }, 502);
      }
      return json({ transcript, words });
    } finally {
      if (geminiFile.name) fetch(`https://generativelanguage.googleapis.com/v1beta/${geminiFile.name}`, { method: "DELETE", headers: { "x-goog-api-key": env.GEMINI_API_KEY } }).catch(() => {});
    }
  }

  if (b.action === "generate-script") {
    if (!env.GEMINI_API_KEY) return json({ error: "AI is not configured. Add GEMINI_API_KEY to the cloud-function environment." }, 503);
    const title = String(b.title || "").trim().slice(0, 200), unit = String(b.unit || "").trim().slice(0, 100);
    const minutes = Number(b.minutes), rant = Number(b.rant), tones = ["Energetic and conversational", "Dryly funny", "Dramatic storytelling", "Clear and classroom-friendly", "Sharp and argumentative"];
    const tone = tones.includes(b.tone) ? b.tone : "Energetic and conversational";
    if (!title) return json({ error: "Add an episode title or topic first." }, 400);
    if (![3, 5, 8, 10, 15, 20].includes(minutes)) return json({ error: "Choose a script length from 3 to 20 minutes." }, 400);
    if (!Number.isInteger(rant) || rant < 1 || rant > 5) return json({ error: "Choose a rant level from 1 to 5." }, 400);
    const targetWords = minutes * 135;
    const input = "Write a ready-to-record podcast script for The Agastya Archive, an AP World History show. Topic/title: " + title + ". Course unit: " + (unit || "not specified") + ". Target length: about " + minutes + " minutes at a natural speaking pace, roughly " + targetWords + " words. Tone: " + tone + ". Rant level: " + rant + "/5, where 1 is lightly opinionated and 5 is a fiery, funny rant. Keep criticism aimed at historical choices, systems, and arguments, never at people based on identity. Give the script a strong opening hook, clear transitions, accurate historical context, and a memorable closing. Use spoken language, occasional concise delivery cues in brackets, and paragraphs that are easy to read aloud. Do not invent quotations, sources, or facts; avoid unsupported certainty and explain nuance where needed. Return only the script. Context from the host, if any: " + String(b.description || "").trim().slice(0, 2000);
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", { method: "POST", headers: { "x-goog-api-key": env.GEMINI_API_KEY, "Content-Type": "application/json", "Api-Revision": "2026-05-20" }, body: JSON.stringify({ model: env.GEMINI_TEXT_MODEL || "gemini-3.8-flash", input, background: true, store: true, generation_config: { thinking_level: "low", max_output_tokens: 8192 } }) });
    let result = {}; try { result = await response.json(); } catch {}
    if (!response.ok) return json({ error: result.error?.message || "Gemini script generation failed (HTTP " + response.status + ")." }, 502);
    const interactionId = result.id || result.interaction?.id;
    if (!interactionId) return json({ error: "Gemini did not return a background interaction ID." }, 502);
    return json({ interactionId, status: result.status || "in_progress" });
  }

  if (b.action === "script-status") {
    if (!env.GEMINI_API_KEY) return json({ error: "AI is not configured. Add GEMINI_API_KEY to the cloud-function environment." }, 503);
    const id = String(b.id || "");
    if (!/^[A-Za-z0-9_-]{10,200}$/.test(id)) return json({ error: "Bad script generation ID." }, 400);
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions/" + encodeURIComponent(id), { headers: { "x-goog-api-key": env.GEMINI_API_KEY, "Api-Revision": "2026-05-20" } });
    let result = {}; try { result = await response.json(); } catch {}
    if (!response.ok) return json({ error: result.error?.message || "Gemini script status failed (HTTP " + response.status + ")." }, 502);
    const status = String(result.status || "in_progress");
    const script = (result.steps || []).filter(step => step.type === "model_output").flatMap(step => step.content || []).filter(item => item.type === "text").map(item => item.text || "").join("\n").trim();
    if (status === "completed" && !script) return json({ error: "Gemini completed the request without returning a script.", status });
    if (["failed", "cancelled", "incomplete"].includes(status)) return json({ error: "Gemini generation ended with status: " + status + ". " + interactionFailure(result) + " (Interaction " + id + ")", status });
    return json({ status, ...(status === "completed" ? { script: script.slice(0, 50000) } : {}) });
  }

  if (b.action === "generate-chapters") {
    if (!env.GEMINI_API_KEY) return json({ error: "AI is not configured. Add GEMINI_API_KEY to the cloud-function environment." }, 503);
    const title = String(b.title || "").trim().slice(0, 200), unit = String(b.unit || "").trim().slice(0, 100);
    const duration = Number(b.duration), segments = Array.isArray(b.segments) ? b.segments.slice(0, 600) : [];
    if (!title) return json({ error: "Add an episode title before generating chapters." }, 400);
    if (!(duration > 0 && duration <= 24 * 60 * 60) || !segments.length) return json({ error: "A transcript with timestamps is required to generate chapters." }, 400);
    const context = segments.map(segment => {
      const time = Number(segment.time), text = String(segment.text || "").trim().slice(0, 1200);
      if (!Number.isFinite(time) || time < 0 || time > duration || !text) return "";
      return "[" + Math.floor(time / 60) + ":" + String(Math.floor(time % 60)).padStart(2, "0") + "] " + text;
    }).filter(Boolean).join("\n").slice(0, 80000);
    if (!context) return json({ error: "No usable timestamped transcript segments were provided." }, 400);
    const example = JSON.stringify({ chapters: [{ time: 0, title: "Introduction" }] });
    const input = "Create useful podcast chapters from the timestamped transcript below. Return only valid JSON in this shape: " + example + ". Include an opening chapter at or near 0 seconds, then add a chapter when the subject meaningfully changes, usually every 2 to 5 minutes. Use concise, specific titles, no more than 10 words each. Times must be seconds from the start and within the recording duration of " + Math.round(duration) + " seconds. Do not invent topics. Episode: " + title + ". AP World unit: " + unit + ". Timestamped transcript:\n" + context;
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", { method: "POST", headers: { "x-goog-api-key": env.GEMINI_API_KEY, "Content-Type": "application/json", "Api-Revision": "2026-05-20" }, body: JSON.stringify({ model: env.GEMINI_TEXT_MODEL || "gemini-3.8-flash", input, background: true, store: true, generation_config: { thinking_level: "low", max_output_tokens: 4096 } }) });
    let result = {}; try { result = await response.json(); } catch {}
    if (!response.ok) return json({ error: result.error?.message || "Gemini chapter generation failed (HTTP " + response.status + ")." }, 502);
    const interactionId = result.id || result.interaction?.id;
    if (!interactionId) return json({ error: "Gemini did not return a chapter-generation ID." }, 502);
    return json({ interactionId, status: result.status || "in_progress" });
  }

  if (b.action === "chapter-status") {
    if (!env.GEMINI_API_KEY) return json({ error: "AI is not configured. Add GEMINI_API_KEY to the cloud-function environment." }, 503);
    const id = String(b.id || ""), duration = Number(b.duration);
    if (!/^[A-Za-z0-9_-]{10,200}$/.test(id)) return json({ error: "Bad chapter generation ID." }, 400);
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions/" + encodeURIComponent(id), { headers: { "x-goog-api-key": env.GEMINI_API_KEY, "Api-Revision": "2026-05-20" } });
    let result = {}; try { result = await response.json(); } catch {}
    if (!response.ok) return json({ error: result.error?.message || "Gemini chapter status failed (HTTP " + response.status + ")." }, 502);
    const status = String(result.status || "in_progress");
    if (status !== "completed") {
      if (["failed", "cancelled", "incomplete"].includes(status)) return json({ error: "Gemini chapter generation ended with status: " + status + ". " + interactionFailure(result) + " (Interaction " + id + ")", status });
      return json({ status });
    }
    const output = (result.steps || []).filter(step => step.type === "model_output").flatMap(step => step.content || []).filter(item => item.type === "text").map(item => item.text || "").join("\n").trim();
    const cleaned = output.replace(/^\x60{3}(?:json)?\s*/i, "").replace(/\s*\x60{3}\s*$/, "");
    let parsed;
    try { parsed = JSON.parse(cleaned); } catch { return json({ error: "Gemini returned chapter data that was not valid JSON." }, 502); }
    const chapters = (Array.isArray(parsed.chapters) ? parsed.chapters : []).map(chapter => ({ time: Number(chapter.time), title: String(chapter.title || "").trim().slice(0, 100) })).filter(chapter => Number.isFinite(chapter.time) && chapter.time >= 0 && chapter.time <= duration && chapter.title).sort((a, b) => a.time - b.time).slice(0, 50);
    if (!chapters.length) return json({ error: "Gemini returned no usable chapters." }, 502);
    if (chapters[0].time > 10) chapters.unshift({ time: 0, title: "Introduction" });
    return json({ status, chapters });
  }

  if (b.action === "describe") {
    if (!env.GEMINI_API_KEY) return json({ error: "AI is not configured. Add GEMINI_API_KEY to the cloud-function environment." }, 503);
    const transcript = String(b.transcript || "").trim();
    if (!transcript) return json({ error: "Add a transcript first." }, 400);
    if (transcript.length > 100000) return json({ error: "Transcript is too long to generate a description." }, 400);
    const input = `Write a lively, accurate 2â€“3 sentence episode description for The Agastya Archive, an AP World History podcast. Use the episode title and unit for context. Base claims only on the transcript. Do not invent topics or conclusions. Return only the description.\n\nTitle: ${String(b.title || "").slice(0, 200)}\nUnit: ${String(b.unit || "").slice(0, 100)}\nTranscript:\n${transcript}`;
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", { method: "POST", headers: { "x-goog-api-key": env.GEMINI_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ model: env.GEMINI_TEXT_MODEL || "gemini-3.8-flash", input }) });
    let result = {}; try { result = await response.json(); } catch {}
    if (!response.ok) return json({ error: result.error?.message || `Gemini description generation failed (HTTP ${response.status}).` }, 502);
    const description = (result.outputs || []).filter(item => item.type === "text").map(item => item.text || "").join("\n").trim();
    if (!description) return json({ error: "Gemini returned no description." }, 502);
    return json({ description: description.slice(0, 5000) });
  }

  const idx = await load();

  if (b.action === "analytics-summary") {
    const published = new Map(idx.episodes
      .filter(episode => !episode.publishAt || Date.parse(episode.publishAt) <= Date.now())
      .map(episode => [episode.id, episode.title]));
    const listeners = new Set(), hourly = Array(24).fill(0), daily = [], episodePlays = new Map();
    const today = new Date();
    for (let offset = 29; offset >= 0; offset--) {
      const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - offset));
      const day = date.toISOString().slice(0, 10);
      const { blobs } = await store.list({ prefix: `analytics/listens/${day}/`, consistency: "strong" });
      let plays = 0;
      for (const blob of blobs) {
        const match = blob.key.match(/^analytics\/listens\/\d{4}-\d{2}-\d{2}\/(\d{2})\/([a-f0-9]{64})\/([a-z0-9]{6,20})\.json$/);
        if (!match || !published.has(match[3])) continue;
        const hour = Number(match[1]);
        if (hour < 0 || hour > 23) continue;
        listeners.add(match[2]);
        hourly[hour]++;
        plays++;
        episodePlays.set(match[3], (episodePlays.get(match[3]) || 0) + 1);
      }
      daily.push({ date: day, plays });
    }
    const topHour = hourly.reduce((best, count, hour) => count > hourly[best] ? hour : best, 0);
    const topEpisodes = [...episodePlays.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, plays]) => ({ id, title: published.get(id), plays }));
    return json({
      days: 30,
      listeners: listeners.size,
      plays: hourly.reduce((sum, count) => sum + count, 0),
      hourly,
      daily,
      topHour: hourly[topHour] ? topHour : null,
      topEpisodes
    });
  }

  if (b.action === "list-scheduled") return json({ episodes: idx.episodes.filter(e => e.publishAt && Date.parse(e.publishAt) > Date.now()).sort((a, b) => Date.parse(a.publishAt) - Date.parse(b.publishAt)) });

  if (b.action === "publish-now" || b.action === "set-schedule") {
    const id = String(b.id || ""), episode = idx.episodes.find(e => e.id === id);
    if (!episode) return json({ error: "Not found" }, 404);
    if (b.action === "publish-now") episode.publishAt = null;
    else {
      const when = Date.parse(b.publishAt || "");
      if (!Number.isFinite(when) || when <= Date.now()) return json({ error: "Choose a future publish time." }, 400);
      episode.publishAt = new Date(when).toISOString();
    }
    await store.setJSON("episodes.json", idx);
    return json({ ok: true, episode });
  }

  if (b.action === "publish") {
    const e = b.episode || {}, id = String(e.id || "");
    if (!/^[a-z0-9]{6,20}$/.test(id)) return json({ error: "Bad id" }, 400);
    const chunks = Math.floor(+e.chunks), size = Math.floor(+e.size);
    if (!(chunks >= 1 && chunks <= MAX_CHUNKS && size > (chunks - 1) * CHUNK && size <= chunks * CHUNK)) return json({ error: "Bad size" }, 400);
    const { blobs } = await store.list({ prefix: `audio/${id}/`, consistency: "strong" });
    if (blobs.length !== chunks) return json({ error: `Expected ${chunks} audio parts, found ${blobs.length}` }, 400);
    const title = String(e.title || "").trim().slice(0, 200);
    if (!title) return json({ error: "Title required" }, 400);
    const requestedPublishAt = String(e.publishAt || "").trim(), publishTime = requestedPublishAt ? Date.parse(requestedPublishAt) : NaN;
    if (requestedPublishAt && (!Number.isFinite(publishTime) || publishTime <= Date.now())) return json({ error: "Choose a future publish time, or leave it blank to publish now." }, 400);
    const rec = {
      id, num: idx.episodes.reduce((m, x) => Math.max(m, x.num || 0), 0) + 1, title,
      unit: String(e.unit || "").slice(0, 80),
      date: /^\d{4}-\d{2}-\d{2}$/.test(e.date) ? e.date : new Date().toISOString().slice(0, 10),
      rant: Math.min(5, Math.max(1, +e.rant || 3)),
      desc: String(e.desc || "").trim().slice(0, 5000),
      transcript: String(e.transcript || "").trim().slice(0, 200000),
      transcriptWords: Array.isArray(e.transcriptWords) ? e.transcriptWords.slice(0, 30000).map(word => ({ word: String(word.word || "").slice(0, 100), start: Number(word.start), end: Number(word.end) })).filter(word => word.word && Number.isFinite(word.start) && Number.isFinite(word.end) && word.start >= 0 && word.end >= word.start) : [],
      chapters: Array.isArray(e.chapters) ? e.chapters.slice(0, 50).map(chapter => ({ time: Number(chapter.time), title: String(chapter.title || "").trim().slice(0, 100) })).filter(chapter => Number.isFinite(chapter.time) && chapter.time >= 0 && chapter.title).sort((a, b) => a.time - b.time) : [],
      publishAt: requestedPublishAt ? new Date(publishTime).toISOString() : null,
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
    try { // best effort: drop the episode's reactions too
      const { blobs: votes } = await store.list({ prefix: `reactions/v/${id}/`, consistency: "strong" });
      for (const o of votes) await store.delete(o.key);
      await store.delete(`reactions/c/${id}.json`);
    } catch (e) {}
    return json({ ok: true });
  }
  return json({ error: "Unknown action" }, 400);
}

export async function onRequest(context) {
  try { return await handle(context); }
  catch (e) { return json({ error: "Server error: " + (e && e.message || e) }, 500); }
}