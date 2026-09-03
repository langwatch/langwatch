/**
 * FROZEN TWIN of the COLLECTOR half of
 * `platform/app/src/shared/traces/mediaParts.ts`. The application keeps its
 * copy while both graphs ingest; edit neither without editing the other.
 *
 * This is the walk that turns an arbitrary span input/output value into the
 * media parts a trace carries — part-first (an object that IS a media part is
 * surfaced and not descended into), generic recursion over every object key
 * and array element, and marker-gated nested-JSON-string hops so a typed-raw
 * envelope still surfaces its media. It mirrors the ingestion-side extraction
 * walker: same depth ceiling, same part-first-stop rule, same marker gate. The
 * two must agree on which shapes they reach — a part the extractor
 * externalizes but the collector never surfaces is stored bytes nothing
 * renders.
 *
 * IT LIVES IN THE CONTRACT because it is the input to the trace-summary media
 * REFERENCES (see `trace-media-ref.ts`), which ride on `TraceListItem` and are
 * read back by the trace read path and the list transport as well as written
 * by the fold. A walk one graph performs differently is a reference one graph
 * mints and the other does not.
 *
 * DELIBERATE DIFFERENCE FROM THE TWIN, and it is a subtraction rather than a
 * change: the application's module also carries five RENDER-side helpers —
 * `isSafeMediaUrl`, `parseNotCapturedMedia`, `mediaRefToMediaData`,
 * `audioPartToMediaData` and `collectAudioParts`. None of them is reached by
 * the walk or by reference collection; they belong to the trace web surface
 * and travel with its conversion. Every function the walk actually calls is
 * here, byte for byte.
 */
import { containsMediaMarkers } from "./trace-media-markers";
import { parseBase64DataUri } from "./trace-content-part.file-decoder";
import { visitContentPart } from "./trace-content-part.dispatcher";
import { isMediaPartRole, type MediaPartRole } from "./trace-media-role";

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
 * Whether an `input_audio` part names a raw, header-less realtime format. The
 * classification is the application's `resolveRawPcmFormat`, reduced to the
 * question this walk actually asks: such a part carries no playable inline
 * source here (see the `inputAudio` branch below).
 */
function isRawPcmFormat(format?: string, mimeType?: string): boolean {
  const f = format?.toLowerCase();
  if (f === "pcm16" || f === "g711_ulaw" || f === "g711_alaw") return true;

  const m = mimeType?.toLowerCase();
  if (!m) return false;
  if (m.includes("pcm16")) return true;
  if (m.includes("ulaw") || m.includes("pcmu") || m === "audio/basic") return true;
  return m.includes("alaw") || m.includes("pcma");
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
      // THE ONE DELIBERATE DIFFERENCE FROM THE TWIN. The application wraps a
      // raw, header-less realtime turn (`pcm16`, companded G.711) into a
      // playable WAV before surfacing it, because a bare `data:audio/wav`
      // carrying raw PCM is silently unplayable. That wrapper is byte work —
      // `Buffer` on the server, `atob`/`btoa` in the browser — and this
      // package is environment-neutral by construction: its tsconfig names
      // `lib: ["es2022"]` and no runtime types, and not one of its sixty
      // modules reaches for either. Adding them here to serve one branch would
      // end that property for every consumer.
      //
      // The difference cannot change what this walk is used for. Reference
      // collection (`trace-media-ref.ts`) admits only `/api/files/` addresses;
      // a wrapped WAV is an inline `data:` source, so BOTH copies contribute
      // exactly no reference for a raw-PCM turn. What the application gets and
      // this does not is a playable part for a RENDERER, and the renderer that
      // wants one converts with the trace web surface, which keeps the
      // wrapper. Pinned in `trace-media-ref.unit.test.ts`.
      if (p.data && isRawPcmFormat(p.format, p.mimeType)) return null;
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
  return collectAnnotatedMediaParts(value, depth).map((part) => part.media);
}

/**
 * The same walk as `collectMediaParts`, keeping the chat role each part was
 * found under. One walker serves both: consumers that only render parts stay
 * on the plain list, and consumers that must tell the caller's media from the
 * agent's reply (the trace summary strips) read the role.
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
