/**
 * mediaParts — pure helpers that turn raw trace message content into the
 * `MediaPartData` shape the simulations `MediaPart` renders: audio players, inline
 * images, video, and file-attachment chips.
 */
import { rawPcmBase64ToWavBase64, resolveRawPcmFormat } from "@langwatch/trace-contract";
import { containsMediaMarkers } from "../content-parts/media-markers";
import {
  parseBase64DataUri,
  visitContentPart,
} from "../../../model/shared/content-parts/visit-content-part";
import { isMediaPartRole, type MediaPartRole, type TraceMediaRef } from "@langwatch/trace-contract";

/**
 * A single renderable media content part, as produced after content
 * extraction. This matches the subset of InputContentPart shapes the
 * `MediaPart` component renders.
 */
export type MediaPartData =
  | {
      type: "image" | "audio" | "video";
      source: { type: "url"; value: string; mimeType?: string };
    }
  | {
      type: "image" | "audio" | "video";
      source: { type: "data"; value: string; mimeType: string };
    }
  | {
      type: "binary";
      mimeType: string;
      id?: string;
      url?: string;
      data?: string;
      filename?: string;
    };

/**
 * Shared recursion ceiling for media walks — identical on the render-side collector
 * (below) and the ingestion-side extractor (`value-media-extractor.ts`), so a part
 * nested at the boundary is either reached by both or by neither.
 */
export const MAX_MEDIA_WALK_DEPTH = 8;

/**
 * A collected media part together with the chat message the walk found it
 * under. `role` is absent when the part was not nested in a message envelope
 * (a bare data-URI attribute, a tool payload, a reply with no role wrapper).
 */
export interface CollectedMediaPart {
  media: MediaPartData;
  role?: MediaPartRole;
}

const AUDIO_FORMAT_MIME: Record<string, string> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  flac: "audio/flac",
  ogg: "audio/ogg",
  webm: "audio/webm",
};

function audioFormatToMimeType(format?: string): string {
  return (format ? AUDIO_FORMAT_MIME[format.toLowerCase()] : undefined) ?? "audio/wav";
}

/** Fallback mime per media category when an inline data source carries none. */
function defaultDataMimeType(type: "image" | "audio" | "video"): string {
  // Each default must be renderable by its own element: a
  // `data:application/octet-stream` src in an <img> is a guaranteed-broken
  // image.
  if (type === "audio") return "audio/wav";
  if (type === "image") return "image/png";
  return "video/mp4";
}

/**
 * Scheme allowlist for any URL that reaches an `href`/`src` from attacker-controllable
 * span content.
 */
export function isSafeMediaUrl(url: string): boolean {
  // Browsers strip ASCII control characters and spaces when parsing an href,
  // so a scheme split by tabs or newlines ("java\tscript:") still executes.
  // Normalize the same way before checking.
  const cleaned = url.replace(/[\u0000-\u0020]/g, "");
  if (cleaned.startsWith("/api/files/")) {
    // ".." would let a same-origin link escape the files route after browser
    // path normalization.
    return !cleaned.includes("..");
  }
  const lower = cleaned.toLowerCase();
  if (lower.startsWith("data:")) return true;
  return lower.startsWith("https://") || lower.startsWith("http://");
}

/** True when the URL points at our own stored-objects read route. */
function isStoredObjectUrl(url: string): boolean {
  return url.startsWith("/api/files/") && !url.includes("..");
}

/**
 * `[image/png, 12345 bytes]` is what an engine writes in place of an attachment it
 * decided not to carry into the trace, most often because the payload was too large for
 * the collector's body limit.
 */
export interface NotCapturedMedia {
  mediaType: string;
  sizeBytes: number;
}

const NOT_CAPTURED_SUMMARY = /^\[([^,\]]+),\s*(\d+)\s*bytes\]$/;

export function parseNotCapturedMedia(value: string): NotCapturedMedia | null {
  const match = NOT_CAPTURED_SUMMARY.exec(value.trim());
  if (!match?.[1] || !match[2]) return null;
  return { mediaType: match[1], sizeBytes: Number(match[2]) };
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
              // Wire payloads often omit the media type. Default it per
              // category. A data: URI built from `undefined`
              // (`data:undefined;…`) is a silently-broken element with no
              // error badge.
              mimeType: p.source.mimeType ?? defaultDataMimeType(p.type),
            },
          };
    },
    // A binary part renders only with an actual payload: inline `data` or a
    // fetchable `url`. An id-only reference has nothing to mount — `src=""`
    // resolves to the current document URL and silently re-requests the page.
    binary: (p) => ((p.data ?? p.url) ? p : null),
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
      // Raw, header-less realtime formats aren't playable as a bare data: URI. Wrap
      // them into a playable WAV: pcm16 gets a header as-is, the companded G.711
      // formats are decoded to linear PCM first (browser WAV decoders are PCM-only).
      const rawFormat = resolveRawPcmFormat(p.format, p.mimeType);
      if (p.data && rawFormat) {
        const wav = rawPcmBase64ToWavBase64(p.data, rawFormat);
        if (wav)
          return {
            type: "audio",
            source: { type: "data", value: wav, mimeType: "audio/wav" },
          };
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

/**
 * Expand a compact trace-summary media ref (fold-derived, url-only) back into
 * the `MediaPartData` shape `MediaPart`/`TraceMediaPart` render.
 */
export function mediaRefToMediaData(ref: TraceMediaRef): MediaPartData {
  if (ref.kind === "file") {
    return {
      type: "binary",
      mimeType: ref.mimeType ?? "application/octet-stream",
      url: ref.url,
      ...(ref.filename ? { filename: ref.filename } : {}),
    };
  }
  return { type: ref.kind, source: { type: "url", value: ref.url } };
}

/** Map a single raw content part to audio `MediaPartData`, or null when it is not audio. */
export function audioPartToMediaData(part: unknown): MediaPartData | null {
  const media = mediaPartToMediaData(part);
  if (!media) return null;
  if (media.type === "audio") return media;
  if (media.type === "binary" && media.mimeType.toLowerCase().startsWith("audio/")) {
    return media;
  }
  return null;
}

/**
 * Collection gate: which mapped parts may be auto-mounted (players, <img>, chips) by
 * the strips and list previews.
 */
export function isRenderableCollectedMedia(media: MediaPartData): boolean {
  if (media.type === "binary") {
    if (media.url != null) return isStoredObjectUrl(media.url);
    return media.data != null;
  }
  if (media.source.type === "url") {
    const url = media.source.value;
    return isStoredObjectUrl(url) || url.startsWith("data:");
  }
  return true;
}

/**
 * Rendering-side gate for parsing a nested JSON string.
 */
function containsRenderableMediaHints(value: string): boolean {
  return containsMediaMarkers(value) || value.includes("/api/files/");
}

/**
 * A string whose ENTIRE value is one media reference — a base64 `data:` URI or an
 * externalized `/api/files/` URL — synthesized into a renderable part.
 */
function bareStringToMediaData(value: string): MediaPartData | null {
  const trimmed = value.trim();
  if (trimmed.length === 0 || /\s/.test(trimmed)) return null;
  if (trimmed.startsWith("data:")) {
    const parsed = parseBase64DataUri(trimmed);
    if (!parsed) return null;
    const mime = parsed.mimeType;
    if (mime.startsWith("image/"))
      return { type: "image", source: { type: "url", value: trimmed } };
    if (mime.startsWith("audio/"))
      return {
        type: "audio",
        source: { type: "url", value: trimmed, mimeType: mime },
      };
    if (mime.startsWith("video/"))
      return {
        type: "video",
        source: { type: "url", value: trimmed, mimeType: mime },
      };
    return { type: "binary", mimeType: mime, url: trimmed };
  }
  if (isStoredObjectUrl(trimmed)) {
    // Kind and mime are unknown from the URL alone — surface it as a chip;
    // the MediaPart existence probe resolves the stored mime on demand.
    return {
      type: "binary",
      mimeType: "application/octet-stream",
      url: trimmed,
    };
  }
  return null;
}

/**
 * Structured walk of an arbitrary trace input/output value, collecting every media part
 * (audio, images, video, attachments).
 */
export function collectMediaParts(value: unknown, depth = 0): MediaPartData[] {
  return collectAnnotatedMediaParts(value, depth).map((part) => part.media);
}

/**
 * The same walk as `collectMediaParts`, keeping the chat role each part was found
 * under.
 */
export function collectAnnotatedMediaParts(value: unknown, depth = 0): CollectedMediaPart[] {
  const out: CollectedMediaPart[] = [];
  collectInto({ value, depth, out });
  return out;
}

function collectInto({
  value,
  depth,
  out,
  role,
}: {
  value: unknown;
  depth: number;
  out: CollectedMediaPart[];
  /** Role of the nearest enclosing chat message, if the walk passed one. */
  role?: MediaPartRole;
}): void {
  if (value == null || depth > MAX_MEDIA_WALK_DEPTH) return;

  const emit = (media: MediaPartData) => {
    if (!isRenderableCollectedMedia(media)) return;
    out.push(role ? { media, role } : { media });
  };

  if (typeof value === "string") {
    const bare = bareStringToMediaData(value);
    if (bare) {
      emit(bare);
      return;
    }
    if (!containsRenderableMediaHints(value)) return;
    const trimmed = value.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return;
    try {
      // The role carries across the nested-JSON hop: a message whose content
      // is a stringified array of parts is still that message's content.
      collectInto({ value: JSON.parse(trimmed), depth: depth + 1, out, role });
    } catch {
      // not JSON — nothing to collect
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const el of value) {
      collectInto({ value: el, depth: depth + 1, out, role });
    }
    return;
  }

  if (typeof value === "object") {
    // Part-first: if this object IS a media part, surface it and stop — same
    // rule as the extractor, which rewrites the part and never descends into
    // it. Non-media objects (message envelopes, typed values, tool results)
    // resolve to null here and are walked generically below.
    const media = mediaPartToMediaData(value);
    if (media) {
      emit(media);
      return;
    }
    const obj = value as Record<string, unknown>;
    // A chat message envelope re-anchors the role for everything below it, so
    // the innermost message wins for a nested transcript.
    const nestedRole = isMediaPartRole(obj.role) ? obj.role : role;
    for (const key of Object.keys(obj)) {
      collectInto({
        value: obj[key],
        depth: depth + 1,
        out,
        role: nestedRole,
      });
    }
  }
}

/** Structured walk of an arbitrary trace input/output value, collecting every audio part. */
export function collectAudioParts(value: unknown, depth = 0): MediaPartData[] {
  return collectMediaParts(value, depth).filter(
    (m) =>
      m.type === "audio" || (m.type === "binary" && m.mimeType.toLowerCase().startsWith("audio/")),
  );
}
