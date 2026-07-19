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
 * in the browser) to match `audioParts.ts`, which imports this on the
 * traces-v2 transcript parse path that also runs during SSR.
 *
 * Scope note: only `pcm16` is wrapped here (24 kHz mono 16-bit little-endian —
 * the OpenAI Realtime capture default). The companded G.711 formats
 * (`g711_ulaw` / `g711_alaw`) need a µ-law/A-law → linear-PCM decode we do not
 * do inline yet, and externalized (URL) raw-PCM references need server-side
 * wrapping on store — both are tracked as follow-ups. `resolveRawPcmFormat`
 * still recognises the G.711 formats so the caller can avoid emitting a
 * silently-broken player for them.
 */

export type RawPcmFormat = "pcm16" | "g711_ulaw" | "g711_alaw";

/** OpenAI Realtime capture default for raw `pcm16` (samples per second). */
const PCM16_SAMPLE_RATE = 24000;

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
  try {
    const pcm = base64ToBytes(dataBase64);
    if (pcm.length === 0) return null;
    return bytesToBase64(wrapPcm16(pcm, PCM16_SAMPLE_RATE));
  } catch {
    return null;
  }
}

/** Prepend a canonical PCM WAV header (mono, 16-bit) to raw pcm16 bytes. */
function wrapPcm16(pcm: Uint8Array, sampleRate: number): Uint8Array {
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
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // audioFormat = 1 (linear PCM)
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
