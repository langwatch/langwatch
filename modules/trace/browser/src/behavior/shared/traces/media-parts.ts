/**
 * mediaParts — pure helpers that turn raw trace message content into the
 * `MediaPartData` shape the simulations `MediaPart` renders: audio players, inline
 * images, video, and file-attachment chips.
 */
import {
  convertRawPcmBase64ToWavBase64,
  detectRawPcmFormat,
  isMediaPartRole,
  type MediaPartRole,
  type TraceMediaRef,
} from "@langwatch/trace-contract";

import {
  parseBase64DataUri,
  type ContentPartVisitor,
  visitContentPart,
} from "../../../model/shared/content-parts/visit-content-part.ts";
import { containsMediaMarkers } from "../content-parts/media-markers.ts";

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
  const cleaned = Array.from(url)
    .filter((character) => character.charCodeAt(0) > 0x20)
    .join("");
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

function mapMediaPart(part: {
  type: "image" | "audio" | "video" | "document";
  source:
    | { type: "url"; value: string; mimeType?: string }
    | { type: "data"; value: string; mimeType?: string };
}): MediaPartData {
  if (part.type === "document") {
    return part.source.type === "url"
      ? {
          type: "binary",
          mimeType: part.source.mimeType ?? "application/octet-stream",
          url: part.source.value,
        }
      : {
          type: "binary",
          mimeType: part.source.mimeType ?? "application/octet-stream",
          data: part.source.value,
        };
  }

  return part.source.type === "url"
    ? {
        type: part.type,
        source: {
          type: "url",
          value: part.source.value,
          mimeType: part.source.mimeType,
        },
      }
    : {
        type: part.type,
        source: {
          type: "data",
          value: part.source.value,
          mimeType: part.source.mimeType ?? defaultDataMimeType(part.type),
        },
      };
}

function mapInputAudioPart(part: {
  data?: string;
  url?: string;
  format?: string;
  mimeType?: string;
}): MediaPartData | null {
  const rawFormat = detectRawPcmFormat(part.format, part.mimeType);
  if (part.data && rawFormat) {
    const wav = convertRawPcmBase64ToWavBase64(part.data, rawFormat);
    return wav
      ? {
          type: "audio",
          source: { type: "data", value: wav, mimeType: "audio/wav" },
        }
      : null;
  }

  const mimeType = part.mimeType ?? audioFormatToMimeType(part.format);
  if (part.url) {
    return { type: "audio", source: { type: "url", value: part.url, mimeType } };
  }
  if (part.data) {
    return { type: "audio", source: { type: "data", value: part.data, mimeType } };
  }
  return null;
}

const MEDIA_PART_VISITOR: ContentPartVisitor<MediaPartData | null> = {
  text: () => null,
  media: mapMediaPart,
  binary: (part) => ((part.data ?? part.url) ? part : null),
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
  inputAudio: mapInputAudioPart,
  unknown: () => null,
};

/** Map a single raw content part to `MediaPartData`, or null when it is not media. */
export function convertMediaPartToMediaData(part: unknown): MediaPartData | null {
  const result = visitContentPart(part, MEDIA_PART_VISITOR);
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
  const media = convertMediaPartToMediaData(part);
  if (!media) return null;
  if (media.type === "audio") return media;
  const isAudioBinary =
    media.type === "binary" && media.mimeType.toLowerCase().startsWith("audio/");
  if (isAudioBinary) {
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

function emitCollectedMedia({
  media,
  out,
  role,
}: {
  media: MediaPartData;
  out: CollectedMediaPart[];
  role?: MediaPartRole;
}): void {
  if (!isRenderableCollectedMedia(media)) return;
  out.push(role ? { media, role } : { media });
}

function collectStringInto({
  value,
  depth,
  out,
  role,
}: {
  value: string;
  depth: number;
  out: CollectedMediaPart[];
  role?: MediaPartRole;
}): void {
  const bare = convertBareStringToMediaData(value);
  if (bare) {
    emitCollectedMedia({ media: bare, out, role });
    return;
  }
  if (!containsRenderableMediaHints(value)) return;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return;

  try {
    collectInto({ value: JSON.parse(trimmed), depth: depth + 1, out, role });
  } catch {
    return;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function collectObjectInto({
  value,
  depth,
  out,
  role,
}: {
  value: Record<string, unknown>;
  depth: number;
  out: CollectedMediaPart[];
  role?: MediaPartRole;
}): void {
  const media = convertMediaPartToMediaData(value);
  if (media) {
    emitCollectedMedia({ media, out, role });
    return;
  }

  const nestedRole = isMediaPartRole(value.role) ? value.role : role;
  for (const nestedValue of Object.values(value)) {
    collectInto({ value: nestedValue, depth: depth + 1, out, role: nestedRole });
  }
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

  if (typeof value === "string") {
    collectStringInto({ value, depth, out, role });
    return;
  }

  if (Array.isArray(value)) {
    for (const el of value) {
      collectInto({ value: el, depth: depth + 1, out, role });
    }
    return;
  }

  if (isRecord(value)) collectObjectInto({ value, depth, out, role });
}

/** Structured walk of an arbitrary trace input/output value, collecting every audio part. */
export function collectAudioParts(value: unknown, depth = 0): MediaPartData[] {
  return collectMediaParts(value, depth).filter(
    (m) =>
      m.type === "audio" || (m.type === "binary" && m.mimeType.toLowerCase().startsWith("audio/")),
  );
}
