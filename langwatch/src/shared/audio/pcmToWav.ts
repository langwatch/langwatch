/**
 * pcmToWav — wrap raw, header-less realtime audio into a minimal WAV
 * (RIFF/WAVE) container so a browser `<audio>` element can actually decode
 * and play it.
 *
 * Raw `pcm16` carries no container, so a `data:audio/wav;base64,<raw-pcm>`
 * URI is silently unplayable — every browser rejects it because there is no
 * RIFF header describing sample rate / channels / bit depth. Prepending a WAV
 * header makes the exact same samples playable, with no re-encode.
 *
 * React-free and isomorphic (base64 via `Buffer` on the server, `atob`/`btoa`
 * in the browser): the client wraps inline base64 turns before playback, and
 * the stored-objects content extractor wraps raw-PCM bytes at store time so
 * externalized references are served as playable `audio/wav` from day one.
 *
 * Formats: `pcm16` (24 kHz mono 16-bit little-endian, the OpenAI Realtime
 * capture default) is wrapped as linear PCM as-is. The companded G.711
 * formats (`g711_ulaw` / `g711_alaw`, 8 kHz telephony) are DECODED to linear
 * PCM16 first: browser <audio> WAV decoders are PCM-only, so a WAV carrying
 * fmt codes 6/7 would be a silently-dead player. The G.711 expansion is the
 * standard table-free CCITT decode — lossless with respect to what the codec
 * carries.
 */

export type RawPcmFormat = "pcm16" | "g711_ulaw" | "g711_alaw";

/** OpenAI Realtime capture default for raw `pcm16` (samples per second). */
const PCM16_SAMPLE_RATE = 24000;

/** Telephony sample rate for the companded G.711 formats. */
const G711_SAMPLE_RATE = 8000;

/**
 * Classify a raw / header-less realtime audio format from an `input_audio`
 * `format` hint and/or a mimeType. Returns null for container formats
 * (wav/mp3/flac/…) and anything unrecognised — those are already playable and
 * must pass through untouched.
 */
export function resolveRawPcmFormat(
  format?: string,
  mimeType?: string,
): RawPcmFormat | null {
  const f = format?.toLowerCase();
  if (f === "pcm16" || f === "g711_ulaw" || f === "g711_alaw") return f;

  const m = mimeType?.toLowerCase();
  if (!m) return null;
  if (m.includes("pcm16")) return "pcm16";
  if (m.includes("ulaw") || m.includes("pcmu") || m === "audio/basic") {
    return "g711_ulaw";
  }
  if (m.includes("alaw") || m.includes("pcma")) return "g711_alaw";
  return null;
}

/**
 * Wrap raw little-endian `pcm16` samples (base64) in a 44-byte WAV header and
 * return the result as base64, ready for a `data:audio/wav;base64,…` URI.
 * Returns null when the payload is empty or cannot be decoded.
 */
export function pcm16ToWavBase64(dataBase64: string): string | null {
  return rawPcmBase64ToWavBase64(dataBase64, "pcm16");
}

/**
 * Wrap (and for G.711, decode) raw realtime audio base64 into WAV base64,
 * ready for a `data:audio/wav;base64,…` URI. Returns null when the payload
 * is empty or cannot be decoded.
 */
export function rawPcmBase64ToWavBase64(
  dataBase64: string,
  format: RawPcmFormat,
): string | null {
  try {
    const samples = base64ToBytes(dataBase64);
    const wrapped = wrapRawPcmToWav(samples, format);
    return wrapped ? bytesToBase64(wrapped) : null;
  } catch {
    return null;
  }
}

/**
 * Decode one G.711 µ-law byte to a linear 16-bit sample (SUN g711.c decode).
 */
function ulawToLinear(byte: number): number {
  const u = ~byte & 0xff;
  let t = ((u & 0x0f) << 3) + 0x84;
  t <<= (u & 0x70) >> 4;
  return u & 0x80 ? 0x84 - t : t - 0x84;
}

/**
 * Decode one G.711 A-law byte to a linear 16-bit sample (SUN g711.c decode).
 */
function alawToLinear(byte: number): number {
  const a = byte ^ 0x55;
  let t = (a & 0x0f) << 4;
  const seg = (a & 0x70) >> 4;
  if (seg === 0) t += 8;
  else if (seg === 1) t += 0x108;
  else {
    t += 0x108;
    t <<= seg - 1;
  }
  return a & 0x80 ? t : -t;
}

/** Expand companded G.711 bytes to linear PCM16 little-endian. */
function g711ToPcm16(
  samples: Uint8Array,
  format: "g711_ulaw" | "g711_alaw",
): Uint8Array {
  const decode = format === "g711_ulaw" ? ulawToLinear : alawToLinear;
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(i * 2, decode(samples[i]!), true);
  }
  return out;
}

/**
 * Wrap raw realtime audio bytes in a WAV container for the given format.
 * Returns null for an empty payload. pcm16 keeps its samples untouched under
 * a linear-PCM header; G.711 is expanded to linear PCM16 first (browser WAV
 * decoders are PCM-only — fmt codes 6/7 would produce a dead player).
 */
export function wrapRawPcmToWav(
  samples: Uint8Array,
  format: RawPcmFormat,
): Uint8Array | null {
  if (samples.length === 0) return null;
  const pcm = format === "pcm16" ? samples : g711ToPcm16(samples, format);
  const sampleRate = format === "pcm16" ? PCM16_SAMPLE_RATE : G711_SAMPLE_RATE;
  const channels = 1;
  const bitsPerSample = 16;
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;

  const out = new Uint8Array(44 + pcm.length);
  const view = new DataView(out.buffer);
  // RIFF chunk descriptor
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + pcm.length, true);
  writeAscii(view, 8, "WAVE");
  // "fmt " sub-chunk
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // linear PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  // "data" sub-chunk
  writeAscii(view, 36, "data");
  view.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

function writeAscii(view: DataView, offset: number, text: string): void {
  Array.from(text).forEach((char, index) => {
    view.setUint8(offset + index, char.charCodeAt(0));
  });
}

function base64ToBytes(base64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base64, "base64"));
  }
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  // Browser: chunk to stay under the argument-count limit of fromCharCode.
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(
      String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)),
    );
  }
  return btoa(chunks.join(""));
}
