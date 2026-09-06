import { z } from "zod";
import { collectAnnotatedMediaParts } from "./trace-media-part.collector.ts";
import { isMediaPartRole, MEDIA_PART_ROLES, type MediaPartRole } from "./trace-media-role.ts";

/**
 * Compact trace-level media references, letting the trace list and drawer
 * show thumbnails without reloading span payloads. Refs are STRICTLY
 * `/api/files/{projectId}/{id}` — no arbitrary URLs.
 */

export const traceMediaRefSchema = z.object({
  kind: z.enum(["audio", "image", "video", "file"]),
  url: z.string(),
  filename: z.string().optional(),
  /** Carried for `file` refs so the attachment chip can pick its icon. */
  mimeType: z.string().optional(),
  /** Role of the chat message the part was found under; absent for pre-role traces. */
  role: z.enum(MEDIA_PART_ROLES).optional(),
});

export type TraceMediaRef = z.infer<typeof traceMediaRefSchema>;

export const RESERVED_INPUT_MEDIA_REFS = "langwatch.reserved.media_refs.input";
export const RESERVED_OUTPUT_MEDIA_REFS = "langwatch.reserved.media_refs.output";

/**
 * THE FORMAT LOGIC BELOW IS A FROZEN TWIN of
 * `platform/app/src/shared/traces/media-refs.ts` — edit neither without the
 * other. Lives in the CONTRACT: one writer, three readers share the column.
 */

/** Which summary strip a ref belongs on. */
export type TraceMediaSide = "input" | "output";

/**
 * Whether media found under the given chat role belongs on the given side.
 * Only the assistant's reply is excluded from INPUT; everything else
 * (including roleless) stays there. Never dropped from both sides.
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

/** Trace-summary refs only ever point at our own stored-objects route (external/data:/javascript: rejected). */
function isStoredObjectRefUrl(url: string): boolean {
  return url.startsWith("/api/files/") && !url.includes("..");
}

/** Walks a span IO value and returns the compact reference list — the fold-side consumer of `collectMediaParts`. */
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
 * Fold two ref lists into one, keeping the first occurrence of each url
 * (content-addressed, so same url = same bytes) and stopping at the cap.
 * `precedence`: the headline span prepends so its media stays the thumbnail.
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

/** One parsed entry, validated: kind allowlisted, url a stored-objects reference, else null. */
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
 * Defensive parse of a reserved media-refs attribute value: assumes nothing
 * about SDK trust, allowlists kinds and urls (`parseMediaRefEntry`).
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
