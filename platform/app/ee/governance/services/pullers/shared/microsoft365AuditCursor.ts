// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Cursor codec for the Management Activity API adapter.
 *
 * The whole subscribe / list / drain state machine rides in the cursor,
 * because that is the only thing the framework persists between runs.
 * `IngestionSource.pollerCursor` is a Json column, but the adapter never sees
 * it as one: `ingestionPullLifecycle.ts:27-34` flattens it with JSON.stringify
 * before it reaches `PullRunOptions.cursor: string | null`. So the cursor
 * carries its own `version` field rather than a `v1:` string prefix — the
 * prefix would make the stored column an opaque string and give up its
 * queryability for nothing.
 *
 * Decoding is deliberately total. A cursor that cannot be understood resumes
 * from the watermark; it never throws, and it never restarts the window from
 * zero. Throwing would wedge a source permanently on one bad write, and
 * restarting from zero would re-pull history every run forever — the failure
 * mode that looks like it is working.
 *
 * Spec: specs/ai-governance/puller-framework/microsoft-365-audit.feature
 */

export const CURSOR_VERSION = 1;

/**
 * The point at which listing stops asking for another page. A busy tenant can
 * publish a lot of content blobs for a window, and this string is written to
 * the database every run, so the listing stops here and the page position is
 * what resumes.
 *
 * This bounds how much MORE gets listed, not what the cursor may carry. It is
 * checked after a page is appended, so the queue can legitimately sit one page
 * above this number. Truncating it back down would drop blob URIs that no
 * later run re-lists — the window would go on to look complete and advance
 * past them, losing the audit records they point at. Deferred, never dropped:
 * anything already queued stays queued.
 */
export const MAX_QUEUED_BLOBS = 200;

/**
 * Absolute ceiling on a decoded queue. Nothing this module writes can reach
 * it — `MAX_QUEUED_BLOBS` plus one listing page is far below. A cursor that
 * arrives above it is corrupt rather than merely large, so it is rejected and
 * the run resumes from the watermark; silently slicing it would be the same
 * data loss in a different place.
 */
export const MAX_CURSOR_BLOBS = 2_000;

export type CursorPhase = "listing" | "draining";

export interface Microsoft365AuditCursor {
  version: number;
  phase: CursorPhase;
  /** ISO 8601. Start of the window being drained. */
  windowStart: string;
  /** ISO 8601. End of the window being drained. */
  windowEnd: string;
  /** Content blob URIs not yet drained, in listing order. */
  blobQueue: string[];
  /** Set when the listing itself paged and more pages remain. */
  nextPageUri?: string;
  /**
   * ISO 8601. Everything at or before this is known-ingested. This is the
   * fallback an unreadable cursor resumes from, so it must only advance when
   * a window is genuinely complete.
   */
  watermark: string;
}

export interface DecodeResult {
  cursor: Microsoft365AuditCursor | null;
  /**
   * Set when the input could not be used as-is. The caller resumes from the
   * watermark and should log this — a source producing it every run is
   * writing cursors it cannot read back.
   */
  recoveredFrom?: string;
}

export function encodeCursor(cursor: Microsoft365AuditCursor): string {
  return JSON.stringify({
    ...cursor,
    version: CURSOR_VERSION,
    // Deliberately not truncated. See MAX_QUEUED_BLOBS: a blob URI dropped
    // here is never re-listed, and the window advances past it.
    blobQueue: cursor.blobQueue,
  });
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}

/**
 * Decode a persisted cursor. Never throws.
 *
 * Returns `{ cursor: null }` for a first-ever run. Returns
 * `{ cursor: null, recoveredFrom }` when the input was unusable — the caller
 * treats that the same as a first run except that it should start from the
 * salvaged watermark if there is one.
 */
/**
 * The candidate as a usable cursor, or the reason it is not one.
 *
 * Split from `decodeCursor` so the rejection ladder stays one flat list of
 * reasons rather than a branch tree wrapped around the happy path. Returning
 * the built cursor rather than a bare "ok" keeps the narrowing each check
 * earned, so the caller needs no casts.
 */
function validateCursor(
  candidate: Record<string, unknown>,
): { cursor: Microsoft365AuditCursor } | { reason: string } {
  if (candidate.version !== CURSOR_VERSION) {
    return { reason: `unknown cursor version ${String(candidate.version)}` };
  }
  if (candidate.phase !== "listing" && candidate.phase !== "draining") {
    return { reason: `unknown cursor phase ${String(candidate.phase)}` };
  }
  if (!isIsoDate(candidate.windowStart) || !isIsoDate(candidate.windowEnd)) {
    return { reason: "cursor window was not a pair of ISO timestamps" };
  }
  if (!isStringArray(candidate.blobQueue)) {
    return { reason: "cursor blobQueue was not a list of strings" };
  }
  if (candidate.blobQueue.length > MAX_CURSOR_BLOBS) {
    // Rejected rather than sliced: keeping the first N would silently drop
    // the rest, and the window would then advance past blobs nobody read.
    // Resuming from the watermark re-lists the window instead.
    return {
      reason: `cursor blobQueue held ${candidate.blobQueue.length} entries, above the ${MAX_CURSOR_BLOBS} ceiling`,
    };
  }
  if (!isIsoDate(candidate.watermark)) {
    return { reason: "cursor watermark was not an ISO timestamp" };
  }
  return {
    cursor: {
      version: CURSOR_VERSION,
      phase: candidate.phase,
      windowStart: candidate.windowStart,
      windowEnd: candidate.windowEnd,
      blobQueue: candidate.blobQueue,
      ...(typeof candidate.nextPageUri === "string"
        ? { nextPageUri: candidate.nextPageUri }
        : {}),
      watermark: candidate.watermark,
    },
  };
}

/**
 * The stored cursor as a plain object, or the reason it is not one.
 *
 * A JSON document that is merely a string is the legacy bare-cursor shape;
 * unparseable input is corruption. Neither carries anything to salvage, so
 * both are a clean restart.
 */
function parseCursorObject(
  raw: string,
): { candidate: Record<string, unknown> } | { reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { reason: "cursor was not JSON" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { reason: "cursor was not an object" };
  }
  return { candidate: parsed as Record<string, unknown> };
}

export function decodeCursor(raw: string | null): DecodeResult {
  if (raw === null || raw.trim() === "") return { cursor: null };

  const parsedResult = parseCursorObject(raw);
  if ("reason" in parsedResult) {
    return { cursor: null, recoveredFrom: parsedResult.reason };
  }
  const { candidate } = parsedResult;

  // Salvage the watermark before rejecting anything else: it is the one
  // field worth keeping from a cursor we otherwise cannot use.
  const salvagedWatermark = isIsoDate(candidate.watermark)
    ? candidate.watermark
    : null;
  const withWatermark = (reason: string): DecodeResult =>
    salvagedWatermark === null
      ? { cursor: null, recoveredFrom: reason }
      : {
          cursor: {
            version: CURSOR_VERSION,
            phase: "listing",
            windowStart: salvagedWatermark,
            windowEnd: salvagedWatermark,
            blobQueue: [],
            watermark: salvagedWatermark,
          },
          recoveredFrom: reason,
        };

  const validated = validateCursor(candidate);
  if ("reason" in validated) return withWatermark(validated.reason);
  return { cursor: validated.cursor };
}
