/**
 * Compact trace-level media references.
 *
 * The trace summary's ComputedInput/ComputedOutput are flattened
 * human-readable text — media parts (players, images, attachments) only
 * exist at span level. So the IO accumulation ALSO derives a compact list of
 * media references from the winning span IO and stores it in the summary's
 * reserved attributes, giving the trace list and the drawer summary a way to
 * show thumbnails and players without reloading span payloads.
 *
 * Refs are STRICTLY `/api/files/{projectId}/{id}` references — the shape the
 * extraction pipeline mints. Inline base64 would re-bloat the summary row the
 * extraction just slimmed, and an arbitrary URL here would hand every list
 * viewer's browser to whoever controls span content, so both the collector
 * and the defensive parser reject anything else. Capped to a handful per
 * side — enough for a preview, never a payload.
 */

import { collectMediaParts } from "~/shared/traces/mediaParts";

export interface TraceMediaRef {
  kind: "audio" | "image" | "video" | "file";
  url: string;
  filename?: string;
  /** Carried for `file` refs so the attachment chip can pick its icon. */
  mimeType?: string;
}

export const MAX_TRACE_MEDIA_REFS = 4;

export const RESERVED_INPUT_MEDIA_REFS = "langwatch.reserved.media_refs.input";
export const RESERVED_OUTPUT_MEDIA_REFS =
  "langwatch.reserved.media_refs.output";

function kindFromMime(mimeType: string): TraceMediaRef["kind"] {
  const mime = mimeType.toLowerCase();
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("image/")) return "image";
  return "file";
}

/**
 * Trace-summary refs only ever point at our own stored-objects read route.
 * Anything else — external http(s), `data:` payloads (bloat), `javascript:`
 * (XSS), protocol-relative — is dropped both when folding refs in and when
 * parsing them back out.
 */
function isStoredObjectRefUrl(url: string): boolean {
  return url.startsWith("/api/files/") && !url.includes("..");
}

/**
 * Walks a span IO value (typed envelope, messages, nested JSON strings — the
 * same shapes `collectMediaParts` handles) and returns the compact reference
 * list. `collectMediaParts` is React-free and isomorphic by design; this is
 * its fold-side consumer.
 */
export function collectMediaRefs(value: unknown): TraceMediaRef[] {
  const refs: TraceMediaRef[] = [];
  for (const part of collectMediaParts(value)) {
    if (refs.length >= MAX_TRACE_MEDIA_REFS) break;
    if (part.type === "binary") {
      if (!part.url || !isStoredObjectRefUrl(part.url)) continue;
      const kind = kindFromMime(part.mimeType);
      refs.push({
        kind,
        url: part.url,
        ...(part.filename ? { filename: part.filename } : {}),
        ...(kind === "file" ? { mimeType: part.mimeType } : {}),
      });
    } else if (
      part.source.type === "url" &&
      isStoredObjectRefUrl(part.source.value)
    ) {
      refs.push({ kind: part.type, url: part.source.value });
    }
  }
  return refs;
}

/** JSON for the reserved attribute, or null when there is nothing to store. */
export function serializeMediaRefs(value: unknown): string | null {
  const refs = collectMediaRefs(value);
  return refs.length > 0 ? JSON.stringify(refs) : null;
}

const VALID_KINDS = new Set(["audio", "image", "video", "file"]);

/**
 * Defensive parse of a reserved media-refs attribute value. The attribute
 * namespace is not writable by SDKs in the normal flow, but nothing in this
 * parser assumes that: kinds are allowlisted and every url must be a
 * stored-objects reference, so a crafted attribute cannot smuggle an
 * external or scripted URL to a renderer.
 */
export function parseMediaRefs(
  serialized: string | null | undefined,
): TraceMediaRef[] {
  if (!serialized) return [];
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!Array.isArray(parsed)) return [];
    const refs: TraceMediaRef[] = [];
    for (const entry of parsed) {
      if (refs.length >= MAX_TRACE_MEDIA_REFS) break;
      if (typeof entry !== "object" || entry === null) continue;
      const candidate = entry as Record<string, unknown>;
      if (
        typeof candidate.kind === "string" &&
        VALID_KINDS.has(candidate.kind) &&
        typeof candidate.url === "string" &&
        isStoredObjectRefUrl(candidate.url)
      ) {
        refs.push({
          kind: candidate.kind as TraceMediaRef["kind"],
          url: candidate.url,
          ...(typeof candidate.filename === "string"
            ? { filename: candidate.filename }
            : {}),
          ...(typeof candidate.mimeType === "string"
            ? { mimeType: candidate.mimeType }
            : {}),
        });
      }
    }
    return refs;
  } catch {
    return [];
  }
}
