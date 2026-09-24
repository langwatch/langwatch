import { visitContentPart } from "./trace-content-part.dispatcher.ts";
import { parseBase64DataUri } from "./trace-content-part.file-decoder.ts";
import type { ContentSource } from "./trace-content-part.types.ts";
/**
 * FROZEN TWIN: platform/app/src/shared/traces/mediaParts.ts (collector half).
 * Walk that extracts media parts from span input/output. Must match ingestion walker
 * for consistent reference collection. See `trace-media-ref.ts` for references.
 */
import { containsMediaMarkers } from "./trace-media-markers.ts";
import { isMediaPartRole, type MediaPartRole } from "./trace-media-role.ts";

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
 * Shared recursion ceiling for media walks — identical on the render-side
 * collector and `value-media-extractor.ts`, so a boundary-nested part is
 * reached by both or by neither.
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

/** True when the URL points at our own stored-objects read route. */
function isStoredObjectUrl(url: string): boolean {
  return url.startsWith("/api/files/") && !url.includes("..");
}

/**
 * Whether an `input_audio` part names a raw, header-less realtime format —
 * such a part carries no playable inline source here (see `inputAudio`
 * below).
 */
function isRawPcmFormat(format?: string, mimeType?: string): boolean {
  const f = format?.toLowerCase();
  if (f === "pcm16" || f === "g711_ulaw" || f === "g711_alaw") return true;

  const m = mimeType?.toLowerCase();
  if (!m) return false;
  if (m.includes("pcm16")) return true;
  const isUlaw = m.includes("ulaw") || m.includes("pcmu") || m === "audio/basic";
  if (isUlaw) return true;
  return m.includes("alaw") || m.includes("pcma");
}

/** A document renders as an attachment chip — the binary member. */
function documentToMediaData(source: ContentSource): MediaPartData {
  const mimeType = source.mimeType ?? "application/octet-stream";

  return source.type === "url"
    ? { type: "binary", mimeType, url: source.value }
    : { type: "binary", mimeType, data: source.value };
}

/**
 * MediaPartData's members split on source.type; narrow before building each
 * variant to stay cast-free. Wire payloads often omit the media type, so an
 * inline payload defaults it per category.
 */
function providerMediaToMediaData(
  p: Readonly<{ type: "image" | "audio" | "video" | "document"; source: ContentSource }>,
): MediaPartData {
  if (p.type === "document") return documentToMediaData(p.source);

  if (p.source.type === "url") {
    return {
      type: p.type,
      source: { type: "url", value: p.source.value, mimeType: p.source.mimeType },
    };
  }

  return {
    type: p.type,
    source: {
      type: "data",
      value: p.source.value,
      mimeType: p.source.mimeType ?? defaultDataMimeType(p.type),
    },
  };
}

/**
 * DELIBERATE DIFFERENCE: application wraps raw PCM audio into playable WAV
 * (byte work). This package omits it; reference collection ignores data: anyway.
 */
function convertInputAudioToMediaData(
  p: Readonly<{ data?: string; url?: string; format?: string; mimeType?: string }>,
): MediaPartData | null {
  if (p.data && isRawPcmFormat(p.format, p.mimeType)) return null;

  const mimeType = p.mimeType ?? audioFormatToMimeType(p.format);
  if (p.url) return { type: "audio", source: { type: "url", value: p.url, mimeType } };
  if (p.data) return { type: "audio", source: { type: "data", value: p.data, mimeType } };

  return null;
}

/** Map a single raw content part to `MediaPartData`, or null when it is not media. */
export function convertMediaPartToMediaData(part: unknown): MediaPartData | null {
  const result = visitContentPart<MediaPartData | null>(part, {
    text: () => null,
    media: providerMediaToMediaData,
    // A binary part renders only with an actual payload: inline `data` or a
    // fetchable `url`. An id-only reference has nothing to mount — `src=""`
    // resolves to the current document URL and silently re-requests the page.
    binary: (p) => ((p.data ?? p.url) ? p : null),
    toolCall: () => null,
    toolResult: () => null,
    imageUrl: (url) => ({ type: "image", source: { type: "url", value: url } }),
    bareImage: (src) => ({ type: "image", source: { type: "url", value: src } }),
    inputAudio: convertInputAudioToMediaData,
    unknown: () => null,
  });

  return result ?? null;
}

/**
 * Collection gate for rendering (auto-mount players/<img>/<video>). Only mount
 * our content (stored objects or data:), not external URLs (security risk).
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
 * Rendering-side gate for parsing a nested JSON string. `containsMediaMarkers`
 * detects INLINE media only; an extracted `/api/files/...` reference carries
 * none, so this also hints on the reference shape.
 */
function containsRenderableMediaHints(value: string): boolean {
  return containsMediaMarkers(value) || value.includes("/api/files/");
}

/**
 * A string whose ENTIRE value is one media reference — a base64 `data:` URI
 * or an externalized `/api/files/` URL — synthesized into a renderable part.
 */
function convertBareStringToMediaData(value: string): MediaPartData | null {
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
 * Collect media parts from arbitrary trace input/output values. Mirrors
 * ingestion walker: part-first, recursive, with media-hint-gated nested JSON.
 */
export function collectMediaParts(value: unknown, depth = 0): MediaPartData[] {
  return collectAnnotatedMediaParts(value, depth).map((part) => part.media);
}

/**
 * The same walk as `collectMediaParts`, keeping the chat role each part was
 * found under, for consumers that must tell the caller's media from the
 * agent's reply.
 */
export function collectAnnotatedMediaParts(value: unknown, depth = 0): CollectedMediaPart[] {
  const out: CollectedMediaPart[] = [];
  collectInto({ value, depth, out });
  return out;
}

type CollectWalk = Readonly<{
  value: unknown;
  depth: number;
  out: CollectedMediaPart[];
  /** Role of the nearest enclosing chat message, if the walk passed one. */
  role?: MediaPartRole;
}>;

function emitCollected(walk: CollectWalk, media: MediaPartData): void {
  if (!isRenderableCollectedMedia(media)) return;
  walk.out.push(walk.role ? { media, role: walk.role } : { media });
}

/** A string is either a bare media payload, or an envelope with media nested inside its JSON. */
function collectFromString(walk: CollectWalk, value: string): void {
  const bare = convertBareStringToMediaData(value);
  if (bare) {
    emitCollected(walk, bare);
    return;
  }
  if (!containsRenderableMediaHints(value)) return;

  const trimmed = value.trim();
  const looksLikeJson = trimmed.startsWith("{") || trimmed.startsWith("[");
  if (!looksLikeJson) return;

  try {
    // The role carries across the nested-JSON hop: a message whose content
    // is a stringified array of parts is still that message's content.
    collectInto({ ...walk, value: JSON.parse(trimmed), depth: walk.depth + 1 });
  } catch {
    // not JSON — nothing to collect
    return;
  }
}

/**
 * Part-first: if this object IS a media part, surface it and stop — same rule as the extractor,
 * which rewrites the part and never descends into it. Non-media objects (message envelopes,
 * typed values, tool results) resolve to null and are walked generically.
 */
function collectFromObject(walk: CollectWalk, value: object): void {
  const media = convertMediaPartToMediaData(value);
  if (media) {
    emitCollected(walk, media);
    return;
  }

  const obj = value as Record<string, unknown>;
  // A chat message envelope re-anchors the role for everything below it, so
  // the innermost message wins for a nested transcript.
  const nestedRole = isMediaPartRole(obj.role) ? obj.role : walk.role;
  for (const key of Object.keys(obj)) {
    collectInto({ value: obj[key], depth: walk.depth + 1, out: walk.out, role: nestedRole });
  }
}

function collectInto(walk: CollectWalk): void {
  const { value, depth } = walk;
  if (value == null || depth > MAX_MEDIA_WALK_DEPTH) return;

  if (typeof value === "string") {
    collectFromString(walk, value);
    return;
  }

  if (Array.isArray(value)) {
    for (const el of value) {
      collectInto({ ...walk, value: el, depth: depth + 1 });
    }
    return;
  }

  if (typeof value === "object") {
    collectFromObject(walk, value);
  }
}
