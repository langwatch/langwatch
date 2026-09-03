import { collectAnnotatedMediaParts } from "./trace-media-part.collector";
import { isMediaPartRole, type MediaPartRole } from "./trace-media-role";

/**
 * Compact trace-level media references, and the chat roles they carry.
 *
 * The trace summary's computed input/output are flattened human-readable
 * text — media parts (players, images, attachments) only exist at span
 * level. So the IO accumulation ALSO derives a compact list of media
 * references from the winning span IO and stores it in the summary's
 * reserved attributes, giving the trace list and the drawer summary a way to
 * show thumbnails and players without reloading span payloads.
 *
 * The shape lives in the contract rather than beside the fold that writes it
 * because it is a READ MODEL: it rides on `TraceListItem`, which the trace
 * transport publishes to every client. A payload type defined in the
 * application would narrow to its declared constraint the moment the
 * transport moved into a package (see the type-narrowing note on
 * `TraceListItem`).
 *
 * Refs are STRICTLY `/api/files/{projectId}/{id}` references — the shape the
 * extraction pipeline mints. Inline base64 would re-bloat the summary row the
 * extraction just slimmed, and an arbitrary URL here would hand every list
 * viewer's browser to whoever controls span content, so both the collector
 * and the defensive parser reject anything else.
 */

export interface TraceMediaRef {
  kind: "audio" | "image" | "video" | "file";
  url: string;
  filename?: string;
  /** Carried for `file` refs so the attachment chip can pick its icon. */
  mimeType?: string;
  /**
   * Role of the chat message the part was found under. A voice turn puts the
   * caller's recording and the agent's reply in the same span payload, so the
   * summary strips need this to show each side its own media. Absent for parts
   * outside a message envelope and for traces ingested before roles were
   * recorded, which every consumer treats as "belongs wherever it used to".
   */
  role?: MediaPartRole;
}

export const RESERVED_INPUT_MEDIA_REFS = "langwatch.reserved.media_refs.input";
export const RESERVED_OUTPUT_MEDIA_REFS = "langwatch.reserved.media_refs.output";

/**
 * THE FORMAT LOGIC BELOW IS A FROZEN TWIN of
 * `platform/app/src/shared/traces/media-refs.ts`. The application keeps its
 * copy while both graphs ingest; edit neither without editing the other.
 *
 * It lives in the CONTRACT rather than in the fold that writes it because the
 * serialised column has three readers and one writer: the projection writes
 * it, and the trace read path, `trace-list.service` and the summary strips all
 * read it back. A format two of them disagree about is a media reference that
 * resolves to nothing — the thumbnail vanishes and no error says why. The url
 * policy is the same argument with teeth: an arbitrary address admitted on the
 * way back in hands every list viewer's browser to whoever controls span
 * content, so the collection side and the parse side apply one rule, once.
 */

/** Which summary strip a ref belongs on. */
export type TraceMediaSide = "input" | "output";

/**
 * Whether media found under the given chat role belongs on the given side.
 *
 * The agent's reply is the only side we can place with certainty, so it is the
 * only one excluded from the input side: everything the caller sent (user,
 * system, tool results, roleless) stays on INPUT, and OUTPUT takes the
 * assistant plus anything with no role recorded. Media is therefore never
 * dropped from both sides.
 *
 * The rule lives here once for every surface that splits a payload by side:
 * the summary strips read it off compact refs, the conversation thread reads
 * it off the parts it collected from the turn.
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
 * Fold two ref lists into one, keeping the first occurrence of each url and
 * stopping at the cap.
 *
 * The url IS the identity: storage is content-addressed, so two refs with the
 * same url are the same bytes reached by two paths through one payload: a
 * message content part and a mirrored field, the same recording quoted by two
 * spans of the trace. Rendering both draws the identical player twice. When one
 * url does arrive under two different chat roles, the first role recorded wins,
 * which puts an echoed recording on the side that actually sent it.
 *
 * `precedence` says where the incoming list goes: the span that wins the
 * trace's headline input/output prepends, so its media stays the trace's
 * thumbnail, and every other span appends behind it.
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
 * Defensive parse of a reserved media-refs attribute value. The attribute
 * namespace is not writable by SDKs in the normal flow, but nothing in this
 * parser assumes that: kinds are allowlisted and every url must be a
 * stored-objects reference (see `parseMediaRefEntry`), so a crafted
 * attribute cannot smuggle an external or scripted URL to a renderer.
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
