/**
 * mediaParts — pure helpers that turn raw trace message content into the
 * `MediaPartData` shape the simulations `MediaPart` renders: audio players,
 * inline images, video, and file-attachment chips.
 *
 * Deliberately React-free: `parsing.ts` (traces-v2 transcript) imports these
 * and runs isomorphically, so a UI import here would drag React into that path.
 * The media component lives separately in `TraceMediaPart.tsx`.
 *
 * All the shape-sniffing is delegated to the canonical `visitContentPart`
 * decoder — we never hand-parse the `input_audio` / AG-UI media / `binary` /
 * `image_url` content-part shapes here.
 */
import type { MediaPartData } from "~/components/simulations/MediaPart";
import { containsMediaMarkers } from "~/server/stored-objects/media-markers";
import { visitContentPart } from "~/server/stored-objects/visit-content-part";
import { pcm16ToWavBase64, resolveRawPcmFormat } from "~/shared/audio/pcmToWav";

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

/** Map a single raw content part to `MediaPartData`, or null when it is not media. */
export function mediaPartToMediaData(part: unknown): MediaPartData | null {
  const result = visitContentPart<MediaPartData | null>(part, {
    text: () => null,
    // MediaPartData's members split on source.type, so narrow before
    // building each concrete variant — keeps this cast-free.
    media: (p) => {
      if (p.type === "document") {
        // Documents render as an attachment chip — the binary member.
        if (p.source.type === "url") {
          return {
            type: "binary",
            mimeType: p.source.mimeType ?? "application/octet-stream",
            url: p.source.value,
          };
        }
        return {
          type: "binary",
          mimeType: p.source.mimeType ?? "application/octet-stream",
          data: p.source.value,
        };
      }
      return p.source.type === "url"
        ? {
            type: p.type,
            source: {
              type: "url",
              value: p.source.value,
              mimeType: p.source.mimeType,
            },
          }
        : {
            type: p.type,
            source: {
              type: "data",
              value: p.source.value,
              // The decoder casts `source` from wire data, so `mimeType` can be
              // undefined at runtime even though the type says string. Default
              // it — a data: URI built from `undefined` (`data:undefined;…`) is
              // a silently-broken element with no error badge.
              mimeType:
                p.source.mimeType ??
                (p.type === "audio" ? "audio/wav" : "application/octet-stream"),
            },
          };
    },
    // Every binary part with a payload renders: audio/image/video mime types
    // resolve to the native element inside MediaPart; anything else becomes a
    // download chip carrying the filename (PDFs, csv, ...).
    binary: (p) => ((p.data ?? p.url ?? p.id) ? p : null),
    toolCall: () => null,
    toolResult: () => null,
    imageUrl: (url) => ({
      type: "image",
      source: { type: "url", value: url },
    }),
    bareImage: (src) => ({
      type: "image",
      source: { type: "url", value: src },
    }),
    inputAudio: (p) => {
      // Raw, header-less realtime formats aren't playable as a bare data: URI.
      // pcm16 (the primary OpenAI Realtime format) is wrapped into a WAV
      // container so it actually plays; g711 is companded and can't be wrapped
      // inline yet, so we return null rather than emit a silently-broken
      // <audio> — it falls back to the raw view. Only inline `data` needs
      // wrapping here: externalized `url` references are WAV-wrapped at store
      // time by the content extractor and served as playable audio/wav.
      const rawFormat = resolveRawPcmFormat(p.format, p.mimeType);
      if (p.data && rawFormat) {
        if (rawFormat === "pcm16") {
          const wav = pcm16ToWavBase64(p.data);
          if (wav)
            return {
              type: "audio",
              source: { type: "data", value: wav, mimeType: "audio/wav" },
            };
        }
        return null;
      }
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

/** Map a single raw content part to audio `MediaPartData`, or null when it is not audio. */
export function audioPartToMediaData(part: unknown): MediaPartData | null {
  const media = mediaPartToMediaData(part);
  if (!media) return null;
  if (media.type === "audio") return media;
  if (
    media.type === "binary" &&
    media.mimeType.toLowerCase().startsWith("audio/")
  ) {
    return media;
  }
  return null;
}

/**
 * An `image_url` part whose URL is plain http(s) is how ordinary chat messages
 * reference remote images — extraction leaves those alone, and surfacing every
 * external link as an inline preview would fetch third-party content on open.
 * Keep collected media to what our pipeline produced (externalized /api/files
 * references and data: URIs) plus explicitly-typed media parts.
 */
function isRenderableCollectedMedia(media: MediaPartData): boolean {
  if (media.type === "image" && media.source.type === "url") {
    const url = media.source.value;
    return url.startsWith("/api/files/") || url.startsWith("data:");
  }
  return true;
}

/**
 * Rendering-side gate for parsing a nested JSON string. The ingest markers
 * (`containsMediaMarkers`) detect INLINE media; after extraction an
 * `image_url` part referencing `/api/files/...` carries none of them, so the
 * collector also hints on the reference shapes. Bare substrings, same
 * escape-proofing rationale as the ingest markers; a false positive costs
 * one JSON.parse of a string that already looked like JSON.
 */
function containsRenderableMediaHints(value: string): boolean {
  return (
    containsMediaMarkers(value) ||
    value.includes("/api/files/") ||
    value.includes("image")
  );
}

/**
 * Structured walk of an arbitrary trace input/output value, collecting every
 * media part (audio, images, video, attachments).
 *
 * Follows the same envelope hops the ingestion-side value walker uses —
 * message arrays, `content` arrays, typed-value `value` fields — and, like
 * it, parses media-hint-gated nested JSON strings so a typed-raw envelope
 * (`{type:"raw", value:"[{...}]"}`) still surfaces its media.
 */
export function collectMediaParts(value: unknown, depth = 0): MediaPartData[] {
  const out: MediaPartData[] = [];
  if (value == null || depth > 5) return out;
  const pushPart = (p: unknown) => {
    const m = mediaPartToMediaData(p);
    if (m && isRenderableCollectedMedia(m)) out.push(m);
  };
  if (typeof value === "string") {
    if (!containsRenderableMediaHints(value)) return out;
    const trimmed = value.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return out;
    try {
      return collectMediaParts(JSON.parse(trimmed), depth + 1);
    } catch {
      return out;
    }
  }
  if (Array.isArray(value)) {
    for (const el of value) {
      pushPart(el);
      if (el && typeof el === "object" && !Array.isArray(el)) {
        const content = (el as Record<string, unknown>).content;
        if (Array.isArray(content)) content.forEach(pushPart);
        else if (typeof content === "string")
          out.push(...collectMediaParts(content, depth + 1));
      }
    }
    return out;
  }
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    // The object may itself be a single media content part — a span whose
    // whole input/output is one bare `input_audio`/`image_url` part with no
    // messages/content envelope around it. Surface it directly; non-media
    // objects (envelopes) resolve to null here and are walked below.
    pushPart(value);
    if (Array.isArray(o.content)) o.content.forEach(pushPart);
    for (const key of [
      "value",
      "messages",
      "input",
      "output",
      "history",
      "data",
    ]) {
      if (o[key] != null) out.push(...collectMediaParts(o[key], depth + 1));
    }
  }
  return out;
}

/** Structured walk of an arbitrary trace input/output value, collecting every audio part. */
export function collectAudioParts(value: unknown, depth = 0): MediaPartData[] {
  return collectMediaParts(value, depth).filter(
    (m) =>
      m.type === "audio" ||
      (m.type === "binary" && m.mimeType.toLowerCase().startsWith("audio/")),
  );
}
