// Resemble returns a WAV; convert it to a small mono MP3 before storing it.
// Short clips use the simple in-memory path; long clips are streamed so the
// cloud function never has to hold the whole WAV (or its decoded samples).
import lamejs from "@breezystack/lamejs";

export const SAMPLE_RATE = 22050;
const BITRATE_KBPS = 64;
const BLOCK_FRAMES = 4096;
const MP3_FRAME = 1152;
const OUT_PART = 2 * 1024 * 1024;

const fourCC = (bytes, o) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);

const fmtAt = (view, bytes, body, size) => {
  if (body + 16 > bytes.byteLength) throw new Error("the WAV header is incomplete");
  const format = view.getUint16(body, true), channels = view.getUint16(body + 2, true), sampleRate = view.getUint32(body + 4, true), bits = view.getUint16(body + 14, true);
  const sub = format === 0xfffe && size >= 40 && body + 26 <= bytes.byteLength ? view.getUint16(body + 24, true) : format;
  return { format: sub, channels, sampleRate, bits };
};

const wavInfo = bytes => {
  const len = bytes.byteLength;
  if (len < 44) throw new Error("the file is too short to be a WAV");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (fourCC(bytes, 0) !== "RIFF" || fourCC(bytes, 8) !== "WAVE") throw new Error("it is not a WAV file");
  let offset = 12, fmt = null, dataOffset = -1, dataSize = 0;
  while (offset + 8 <= len) {
    const id = fourCC(bytes, offset), size = view.getUint32(offset + 4, true), body = offset + 8;
    if (id === "fmt ") fmt = fmtAt(view, bytes, body, size);
    else if (id === "data") { dataOffset = body; dataSize = Math.min(size, len - body); }
    if (fmt && dataOffset >= 0) break;
    offset = body + size + (size & 1);
  }
  if (!fmt || dataOffset < 0 || !fmt.channels || !fmt.sampleRate || !fmt.bits) throw new Error("the WAV file is malformed");
  return { ...fmt, dataOffset, dataSize };
};

const readSample = (view, bytes, o, format, bits) => {
  if (format === 1 && bits === 16) return view.getInt16(o, true);
  if (format === 1 && bits === 24) { const v = bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16); return (v & 0x800000 ? v | 0xff000000 : v) >> 8; }
  if (format === 1 && bits === 32) return view.getInt32(o, true) >> 16;
  if (format === 3 && bits === 32) return Math.max(-1, Math.min(1, view.getFloat32(o, true))) * 32767;
  throw new Error(`unsupported WAV format (${bits}-bit format ${format})`);
};

const wavMono = (bytes, info) => {
  const { format, channels, bits, dataOffset, dataSize } = info, frameBytes = channels * bits / 8;
  if (!Number.isInteger(frameBytes) || frameBytes < 1 || !dataSize) throw new Error("the WAV audio data is empty");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), frames = Math.floor(dataSize / frameBytes), out = new Int16Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += readSample(view, bytes, dataOffset + f * frameBytes + c * (bits / 8), format, bits);
    const v = Math.round(sum / channels);
    out[f] = v < -32768 ? -32768 : v > 32767 ? 32767 : v;
  }
  return out;
};

const resampleMono = (input, from) => {
  if (from === SAMPLE_RATE) return input;
  const ratio = from / SAMPLE_RATE, length = Math.max(1, Math.floor(input.length / ratio)), out = new Int16Array(length);
  for (let i = 0; i < length; i++) {
    const pos = i * ratio, i0 = Math.floor(pos), i1 = i0 + 1 < input.length ? i0 + 1 : input.length - 1, frac = pos - i0;
    out[i] = Math.round(input[i0] + (input[i1] - input[i0]) * frac);
  }
  return out;
};

const encode = pcm => {
  const encoder = new lamejs.Mp3Encoder(1, SAMPLE_RATE, BITRATE_KBPS), parts = [];
  for (let i = 0; i < pcm.length; i += MP3_FRAME) {
    const block = encoder.encodeBuffer(pcm.subarray(i, i + MP3_FRAME));
    if (block.length) parts.push(new Uint8Array(block.buffer, block.byteOffset, block.length).slice());
  }
  const tail = encoder.flush();
  if (tail.length) parts.push(new Uint8Array(tail.buffer, tail.byteOffset, tail.length).slice());
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
};

export function wavToMp3(wav) {
  const info = wavInfo(wav), mp3 = encode(resampleMono(wavMono(wav, info), info.sampleRate));
  if (!mp3.length) throw new Error("the WAV audio data is empty");
  return mp3;
}

export async function streamWavToMp3(body, onPart) {
  const reader = body.getReader();
  let head = new Uint8Array(0);
  const readMore = async () => {
    const { done, value } = await reader.read();
    if (done) return false;
    if (value && value.length) {
      const next = new Uint8Array(head.length + value.length);
      next.set(head); next.set(value, head.length);
      head = next;
    }
    return true;
  };
  try {
    while (head.length < 12) if (!await readMore()) throw new Error("the enhanced audio file is empty");
    if (fourCC(head, 0) !== "RIFF" || fourCC(head, 8) !== "WAVE") throw new Error("it is not a WAV file");
    let offset = 12, fmt = null, dataOffset = -1, dataSize = 0;
    while (dataOffset < 0) {
      while (head.length < offset + 8) if (!await readMore()) throw new Error("the WAV file ended before its audio data");
      const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
      const id = fourCC(head, offset), size = view.getUint32(offset + 4, true), chunk = offset + 8;
      if (id === "fmt ") {
        if (size > 1024 * 1024) throw new Error("the WAV header is too large");
        while (head.length < chunk + size) if (!await readMore()) throw new Error("the WAV header is incomplete");
        fmt = fmtAt(new DataView(head.buffer, head.byteOffset, head.byteLength), head, chunk, size);
        offset = chunk + size + (size & 1);
      } else if (id === "data") { dataOffset = chunk; dataSize = size; }
      else {
        const skip = chunk + size + (size & 1);
        if (skip > 1024 * 1024) throw new Error("the WAV header is too large");
        while (head.length < skip) if (!await readMore()) throw new Error("the WAV header is incomplete");
        offset = skip;
      }
      if (offset > 1024 * 1024) throw new Error("the WAV header is too large");
    }
    if (!fmt || !fmt.channels || !fmt.sampleRate || !fmt.bits) throw new Error("the WAV file is malformed");
    if (!dataSize) throw new Error("the WAV audio data is empty");
    const known = dataSize !== 0xffffffff, bps = fmt.bits >> 3, frameBytes = fmt.channels * bps;
    if (!Number.isInteger(frameBytes) || frameBytes < 1) throw new Error("the WAV file is malformed");
    let dataLeft = known ? dataSize : Infinity, pending = new Uint8Array(0), baseFrame = 0, nextOut = 0, outCount = 0, carry = 0, deferred = [];
    const totalFrames = known ? Math.floor(dataSize / frameBytes) : 0, ratio = fmt.sampleRate / SAMPLE_RATE, outTotal = totalFrames ? Math.max(1, Math.floor(totalFrames / ratio)) : 0;
    const step = ratio, encoder = new lamejs.Mp3Encoder(1, SAMPLE_RATE, BITRATE_KBPS);
    const outBuf = new Int16Array(MP3_FRAME * 10);
    let outLen = 0, mp3Parts = [], mp3Len = 0, totalSize = 0, parts = 0;
    const emit = block => {
      if (!block || !block.length) return;
      mp3Parts.push(new Uint8Array(block.buffer, block.byteOffset, block.length).slice());
      mp3Len += block.length;
    };
    const flush = async force => {
      while (mp3Len >= OUT_PART || (force && mp3Len > 0)) {
        const take = Math.min(OUT_PART, mp3Len), bytes = new Uint8Array(take);
        let at = 0;
        while (at < take) {
          const part = mp3Parts[0], n = Math.min(part.length, take - at);
          bytes.set(part.subarray(0, n), at);
          at += n;
          if (n === part.length) mp3Parts.shift();
          else mp3Parts[0] = part.subarray(n);
        }
        await onPart(bytes);
        parts++; totalSize += take; mp3Len -= take;
      }
    };
    const push = sample => {
      outBuf[outLen++] = sample;
      if (outLen === outBuf.length) { emit(encoder.encodeBuffer(outBuf)); outLen = 0; }
    };
    const block = (bytes, frames) => {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), mono = new Int16Array(frames);
      for (let f = 0; f < frames; f++) {
        let sum = 0;
        for (let c = 0; c < fmt.channels; c++) sum += readSample(view, bytes, f * frameBytes + c * bps, fmt.format, fmt.bits);
        const v = Math.round(sum / fmt.channels);
        mono[f] = v < -32768 ? -32768 : v > 32767 ? 32767 : v;
      }
      for (const d of deferred) {
        if (outTotal && outCount >= outTotal) break;
        push(Math.round(carry + (mono[0] - carry) * d.frac)); outCount++;
      }
      deferred = [];
      const last = baseFrame + frames - 1;
      while ((!outTotal || outCount < outTotal) && nextOut < last) {
        const pos = nextOut - baseFrame, i0 = Math.floor(pos), frac = pos - i0;
        push(Math.round(mono[i0] + (mono[i0 + 1] - mono[i0]) * frac));
        nextOut += step; outCount++;
      }
      while ((!outTotal || outCount < outTotal) && nextOut < baseFrame + frames) {
        const pos = nextOut - baseFrame, i0 = Math.floor(pos), frac = pos - i0;
        if (frac) deferred.push({ frac });
        else { push(mono[i0]); outCount++; }
        nextOut += step;
      }
      carry = mono[frames - 1];
      baseFrame += frames;
    };
    const feed = bytes => {
      if (!bytes || !bytes.length || dataLeft <= 0) return;
      if (bytes.length > dataLeft) bytes = bytes.subarray(0, dataLeft);
      dataLeft -= bytes.length;
      let buf = bytes;
      if (pending.length) {
        const merged = new Uint8Array(pending.length + bytes.length);
        merged.set(pending); merged.set(bytes, pending.length);
        buf = merged;
      }
      const frames = Math.floor(buf.length / frameBytes);
      let at = 0, left = frames;
      while (left > 0) {
        const n = Math.min(left, BLOCK_FRAMES);
        block(buf.subarray(at, at + n * frameBytes), n);
        at += n * frameBytes; left -= n;
      }
      pending = buf.slice(at);
    };
    feed(head.subarray(dataOffset));
    while (dataLeft > 0) {
      const { done, value } = await reader.read();
      if (done) break;
      feed(value);
      await flush(false);
    }
    for (const d of deferred) {
      if (outTotal && outCount >= outTotal) break;
      push(carry); outCount++;
    }
    deferred = [];
    if (outLen) { emit(encoder.encodeBuffer(outBuf.subarray(0, outLen))); outLen = 0; }
    emit(encoder.flush());
    await flush(true);
    if (!parts) throw new Error("the WAV audio data is empty");
    return { parts, size: totalSize };
  } finally {
    try { await reader.cancel(); } catch {}
  }
}
