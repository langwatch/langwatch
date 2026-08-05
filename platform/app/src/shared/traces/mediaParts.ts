/**
 * mediaParts — pure helpers that turn raw trace message content into the
 * `MediaPartData` shape the simulations `MediaPart` renders: audio players,
 * inline images, video, and file-attachment chips.
 *
 * Lives in `shared/` because both sides of the stack depend on it: the
 * traces-v2 transcript and the legacy trace views map parts for rendering,
 * and the fold projection derives compact trace-summary media refs from the
 * same walk (`media-refs.ts`). Nothing here may import React or component
 * code — the fold worker loads this at boot.
 *
 * All the shape-sniffing is delegated to the canonical `visitContentPart`
 * decoder — we never hand-parse the `input_audio` / AG-UI media / `binary` /
 * `image_url` content-part shapes here.
 *
 * The collector walk mirrors the server-side extraction walker
 * (`value-media-extractor.ts`): same depth ceiling, same part-first-stop
 * rule, same generic recursion over every object key, same marker-gated
 * nested-JSON-string hop. The two must agree on which shapes they reach —
 * a part the extractor externalizes but the collector never surfaces is
 * stored bytes nothing renders. `media-walk-parity.unit.test.ts` pins that.
 */
import {
  rawPcmBase64ToWavBase64,
  resolveRawPcmFormat,
} from "~/shared/audio/pcmToWav";
import { containsMediaMarkers } from "~/shared/content-parts/media-markers";
import {
  parseBase64DataUri,
  visitContentPart,
} from "~/shared/content-parts/visit-content-part";
import type { TraceMediaRef } from "~/shared/traces/media-refs";

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
 * collector (below) and the ingestion-side extractor
 * (`value-media-extractor.ts`), so a part nested at the boundary is either
 * reached by both or by neither.
 */
export const MAX_MEDIA_WALK_DEPTH = 8;

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
 * Scheme allowlist for any URL that reaches an `href`/`src` from
 * attacker-controllable span content. `/api/files/` references, `data:`
 * URIs, and absolute http(s) pass; everything else — `javascript:`,
 * `vbscript:`, `blob:`, protocol-relative `//host`, relative paths — is
 * rejected.
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
              // it per category — a data: URI built from `undefined`
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
      // Raw, header-less realtime formats aren't playable as a bare data: URI.
      // Wrap them into a playable WAV: pcm16 gets a header as-is, the
      // companded G.711 formats are decoded to linear PCM first (browser WAV
      // decoders are PCM-only). Only inline `data` needs wrapping here:
      // externalized `url` references are WAV-wrapped at store time by the
      // content extractor and served as playable audio/wav.
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
  if (
    media.type === "binary" &&
    media.mimeType.toLowerCase().startsWith("audio/")
  ) {
    return media;
  }
  return null;
}

/**
 * Collection gate: which mapped parts may be auto-mounted (players, <img>,
 * chips) by the strips and list previews.
 *
 * Only content our own pipeline produced — externalized `/api/files/`
 * references and inline `data:` payloads — passes. An external http(s) URL
 * inside span content would otherwise mount an <img>/<audio>/<video src>
 * that beacons every viewer's IP and timing to an attacker-chosen host, and
 * a `javascript:` URL would reach an anchor href. External links stay links
 * in the raw text view. Applies to EVERY part category: a `binary` part
 * declaring an image mime resolves to an <img> just like an `image` part
 * does, so it is gated the same way.
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
 * Rendering-side gate for parsing a nested JSON string. The ingest markers
 * (`containsMediaMarkers`) detect INLINE media; after extraction an
 * `image_url` part referencing `/api/files/...` carries none of them, so the
 * collector also hints on the reference shape. Bare substrings, same
 * escape-proofing rationale as the ingest markers; a false positive costs
 * one JSON.parse of a string that already looked like JSON.
 */
function containsRenderableMediaHints(value: string): boolean {
  return containsMediaMarkers(value) || value.includes("/api/files/");
}

/**
 * A string whose ENTIRE value is one media reference — a base64 `data:` URI
 * or an externalized `/api/files/` URL — synthesized into a renderable part.
 * This is how a bare data-URI span attribute (no JSON around it) surfaces,
 * and how the bare reference string the extractor rewrites it to renders.
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
 * Structured walk of an arbitrary trace input/output value, collecting every
 * media part (audio, images, video, attachments).
 *
 * Mirrors the ingestion-side extraction walker: part-first (an object that IS
 * a media part is surfaced and not descended into), generic recursion over
 * every object key and array element, and media-hint-gated nested JSON
 * strings so a typed-raw envelope (`{type:"raw", value:"[{...}]"}`) still
 * surfaces its media.
 */
export function collectMediaParts(value: unknown, depth = 0): MediaPartData[] {
  const out: MediaPartData[] = [];
  collectInto(value, depth, out);
  return out;
}

function collectInto(
  value: unknown,
  depth: number,
  out: MediaPartData[],
): void {
  if (value == null || depth > MAX_MEDIA_WALK_DEPTH) return;

  if (typeof value === "string") {
    const bare = bareStringToMediaData(value);
    if (bare) {
      if (isRenderableCollectedMedia(bare)) out.push(bare);
      return;
    }
    if (!containsRenderableMediaHints(value)) return;
    const trimmed = value.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return;
    try {
      collectInto(JSON.parse(trimmed), depth + 1, out);
    } catch {
      // not JSON — nothing to collect
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const el of value) collectInto(el, depth + 1, out);
    return;
  }

  if (typeof value === "object") {
    // Part-first: if this object IS a media part, surface it and stop — same
    // rule as the extractor, which rewrites the part and never descends into
    // it. Non-media objects (message envelopes, typed values, tool results)
    // resolve to null here and are walked generically below.
    const media = mediaPartToMediaData(value);
    if (media) {
      if (isRenderableCollectedMedia(media)) out.push(media);
      return;
    }
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      collectInto(obj[key], depth + 1, out);
    }
  }
}

/** Structured walk of an arbitrary trace input/output value, collecting every audio part. */
export function collectAudioParts(value: unknown, depth = 0): MediaPartData[] {
  return collectMediaParts(value, depth).filter(
    (m) =>
      m.type === "audio" ||
      (m.type === "binary" && m.mimeType.toLowerCase().startsWith("audio/")),
  );
}
