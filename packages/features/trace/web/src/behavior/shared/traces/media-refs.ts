/**
 * Compact trace-level media references.
 */

import { isMediaPartRole, type MediaPartRole, type TraceMediaRef } from "@langwatch/trace-contract";
import { collectAnnotatedMediaParts } from "./media-parts";

/** Which summary strip a ref belongs on. */
export type TraceMediaSide = "input" | "output";

/**
 * Whether media found under the given chat role belongs on the given side.
 */
export function mediaRoleBelongsToSide(
  role: MediaPartRole | undefined,
  side: TraceMediaSide,
): boolean {
  if (side === "output") return role === undefined || role === "assistant";
  return role !== "assistant";
}

/** Whether a ref belongs on the given summary strip. */
export function mediaRefBelongsToSide(ref: TraceMediaRef, side: TraceMediaSide): boolean {
  return mediaRoleBelongsToSide(ref.role, side);
}

export const MAX_TRACE_MEDIA_REFS = 4;

function kindFromMime(mimeType: string): TraceMediaRef["kind"] {
  const mime = mimeType.toLowerCase();
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("image/")) return "image";
  return "file";
}

/**
 * Trace-summary refs only ever point at our own stored-objects read route.
 */
function isStoredObjectRefUrl(url: string): boolean {
  return url.startsWith("/api/files/") && !url.includes("..");
}

/**
 * Walks a span IO value (typed envelope, messages, nested JSON strings — the same
 * shapes `collectMediaParts` handles) and returns the compact reference list.
 */
export function collectMediaRefs(value: unknown): TraceMediaRef[] {
  const refs: TraceMediaRef[] = [];
  const seen = new Set<string>();
  for (const { media, role } of collectAnnotatedMediaParts(value)) {
    if (refs.length >= MAX_TRACE_MEDIA_REFS) break;
    const withRole = role ? { role } : {};
    let ref: TraceMediaRef | null = null;
    if (media.type === "binary") {
      if (!media.url || !isStoredObjectRefUrl(media.url)) continue;
      const kind = kindFromMime(media.mimeType);
      ref = {
        kind,
        url: media.url,
        ...(media.filename ? { filename: media.filename } : {}),
        ...(kind === "file" ? { mimeType: media.mimeType } : {}),
        ...withRole,
      };
    } else if (media.source.type === "url" && isStoredObjectRefUrl(media.source.value)) {
      ref = { kind: media.type, url: media.source.value, ...withRole };
    }
    if (!ref || seen.has(ref.url)) continue;
    seen.add(ref.url);
    refs.push(ref);
  }
  return refs;
}

/**
 * Fold two ref lists into one, keeping the first occurrence of each url and stopping at
 * the cap.
 */
export function mergeMediaRefs({
  existing,
  incoming,
  precedence,
}: {
  existing: TraceMediaRef[];
  incoming: TraceMediaRef[];
  precedence: "prepend" | "append";
}): TraceMediaRef[] {
  const ordered =
    precedence === "prepend" ? [...incoming, ...existing] : [...existing, ...incoming];
  const merged: TraceMediaRef[] = [];
  const seen = new Set<string>();
  for (const ref of ordered) {
    if (merged.length >= MAX_TRACE_MEDIA_REFS) break;
    if (seen.has(ref.url)) continue;
    seen.add(ref.url);
    merged.push(ref);
  }
  return merged;
}

/** JSON for the reserved attribute, or null when the list is empty. */
export function serializeMediaRefList(refs: TraceMediaRef[]): string | null {
  return refs.length > 0 ? JSON.stringify(refs) : null;
}

const VALID_KINDS = new Set(["audio", "image", "video", "file"]);

/**
 * One parsed entry from the reserved attribute, validated: kind must be
 * allowlisted and the url must be a stored-objects reference. Returns null
 * for anything else.
 */
function parseMediaRefEntry(entry: unknown): TraceMediaRef | null {
  if (typeof entry !== "object" || entry === null) return null;
  const candidate = entry as Record<string, unknown>;
  if (
    typeof candidate.kind !== "string" ||
    !VALID_KINDS.has(candidate.kind) ||
    typeof candidate.url !== "string" ||
    !isStoredObjectRefUrl(candidate.url)
  ) {
    return null;
  }
  return {
    kind: candidate.kind as TraceMediaRef["kind"],
    url: candidate.url,
    ...(typeof candidate.filename === "string" ? { filename: candidate.filename } : {}),
    ...(typeof candidate.mimeType === "string" ? { mimeType: candidate.mimeType } : {}),
    // Same allowlist the walk applies, so an unrecognized role read back from
    // the attribute lands on "no role" rather than hiding the ref everywhere.
    ...(isMediaPartRole(candidate.role) ? { role: candidate.role } : {}),
  };
}

/**
 * Defensive parse of a reserved media-refs attribute value.
 */
export function parseMediaRefs(serialized: string | null | undefined): TraceMediaRef[] {
  if (!serialized) return [];
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!Array.isArray(parsed)) return [];
    const refs: TraceMediaRef[] = [];
    for (const entry of parsed) {
      if (refs.length >= MAX_TRACE_MEDIA_REFS) break;
      const ref = parseMediaRefEntry(entry);
      if (ref) refs.push(ref);
    }
    return refs;
  } catch {
    return [];
  }
}
