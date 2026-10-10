export type RawPcmFormat = "pcm16" | "g711_ulaw" | "g711_alaw";

export function resolveRawPcmFormat(format?: string, mimeType?: string): RawPcmFormat | null {
  const normalizedFormat = format?.toLowerCase();
  if (
    normalizedFormat === "pcm16" ||
    normalizedFormat === "g711_ulaw" ||
    normalizedFormat === "g711_alaw"
  )
    return normalizedFormat;
  const normalizedMime = mimeType?.toLowerCase();
  if (!normalizedMime) return null;
  if (normalizedMime.includes("pcm16")) return "pcm16";
  if (
    normalizedMime.includes("ulaw") ||
    normalizedMime.includes("pcmu") ||
    normalizedMime === "audio/basic"
  )
    return "g711_ulaw";
  if (normalizedMime.includes("alaw") || normalizedMime.includes("pcma")) return "g711_alaw";
  return null;
}

export function wrapRawPcmToWav(samples: Uint8Array, format: RawPcmFormat): Uint8Array | null {
  if (samples.length === 0) return null;
  const pcm = format === "pcm16" ? samples : decodeG711(samples, format);
  const sampleRate = format === "pcm16" ? 24000 : 8000;
  const out = new Uint8Array(44 + pcm.length);
  const view = new DataView(out.buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + pcm.length, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

function decodeG711(samples: Uint8Array, format: "g711_ulaw" | "g711_alaw"): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  for (let index = 0; index < samples.length; index += 1) {
    const value =
      format === "g711_ulaw" ? decodeUlaw(samples[index] ?? 0) : decodeAlaw(samples[index] ?? 0);
    view.setInt16(index * 2, value, true);
  }
  return out;
}

function decodeUlaw(byte: number): number {
  const value = ~byte & 0xff;
  let sample = ((value & 0x0f) << 3) + 0x84;
  sample <<= (value & 0x70) >> 4;
  return value & 0x80 ? 0x84 - sample : sample - 0x84;
}

function decodeAlaw(byte: number): number {
  const value = byte ^ 0x55;
  let sample = (value & 0x0f) << 4;
  const segment = (value & 0x70) >> 4;
  if (segment === 0) sample += 8;
  else if (segment === 1) sample += 0x108;
  else {
    sample += 0x108;
    sample <<= segment - 1;
  }
  return value & 0x80 ? sample : -sample;
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (const [index, character] of Array.from(value).entries())
    view.setUint8(offset + index, character.charCodeAt(0));
}
