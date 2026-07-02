/**
 * audioParts — pure helpers that turn raw trace message content into the
 * `MediaPartData` shape the simulations `MediaPart` renders.
 *
 * Deliberately React-free: `parsing.ts` (traces-v2 transcript) imports these
 * and runs isomorphically, so a UI import here would drag React into that path.
 * The audio player component lives separately in `TraceAudioPart.tsx`.
 *
 * All the shape-sniffing is delegated to the canonical `visitContentPart`
 * decoder — we never hand-parse the `input_audio` / AG-UI `audio` / `binary`
 * content-part shapes here.
 */
import type { MediaPartData } from "~/components/simulations/MediaPart";
import { visitContentPart } from "~/server/stored-objects/visit-content-part";

const AUDIO_FORMAT_MIME: Record<string, string> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  flac: "audio/flac",
  ogg: "audio/ogg",
  webm: "audio/webm",
};

function audioFormatToMimeType(format?: string): string {
  return (
    (format ? AUDIO_FORMAT_MIME[format.toLowerCase()] : undefined) ??
    "audio/wav"
  );
}

/** Map a single raw content part to audio `MediaPartData`, or null when it is not audio. */
export function audioPartToMediaData(part: unknown): MediaPartData | null {
  const result = visitContentPart<MediaPartData | null>(part, {
    text: () => null,
    // MediaPartData's audio member splits on source.type, so narrow before
    // building each concrete variant — keeps this cast-free.
    media: (p) => {
      if (p.type !== "audio") return null;
      return p.source.type === "url"
        ? {
            type: "audio",
            source: {
              type: "url",
              value: p.source.value,
              mimeType: p.source.mimeType,
            },
          }
        : {
            type: "audio",
            source: {
              type: "data",
              value: p.source.value,
              mimeType: p.source.mimeType,
            },
          };
    },
    binary: (p) => (p.mimeType.toLowerCase().startsWith("audio/") ? p : null),
    toolCall: () => null,
    toolResult: () => null,
    imageUrl: () => null,
    bareImage: () => null,
    inputAudio: (p) => {
      const mimeType = p.mimeType ?? audioFormatToMimeType(p.format);
      if (p.url)
        return {
          type: "audio",
          source: { type: "url", value: p.url, mimeType },
        };
      if (p.data)
        return {
          type: "audio",
          source: { type: "data", value: p.data, mimeType },
        };
      return null;
    },
    unknown: () => null,
  });
  return result ?? null;
}

/** Structured walk of an arbitrary trace input/output value, collecting every audio part. */
export function collectAudioParts(value: unknown, depth = 0): MediaPartData[] {
  const out: MediaPartData[] = [];
  if (value == null || depth > 5) return out;
  const pushPart = (p: unknown) => {
    const m = audioPartToMediaData(p);
    if (m) out.push(m);
  };
  if (Array.isArray(value)) {
    for (const el of value) {
      pushPart(el);
      if (el && typeof el === "object" && !Array.isArray(el)) {
        const content = (el as Record<string, unknown>).content;
        if (Array.isArray(content)) content.forEach(pushPart);
      }
    }
    return out;
  }
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (Array.isArray(o.content)) o.content.forEach(pushPart);
    for (const key of [
      "value",
      "messages",
      "input",
      "output",
      "history",
      "data",
    ]) {
      if (o[key] != null) out.push(...collectAudioParts(o[key], depth + 1));
    }
  }
  return out;
}
