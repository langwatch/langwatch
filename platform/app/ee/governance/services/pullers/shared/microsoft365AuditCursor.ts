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
 * Cap on blob URIs carried in one cursor. A busy tenant can publish a lot of
 * content blobs for a window, and this string is written to the database
 * every run. Past the cap the listing position is what resumes, not the
 * queue — the work is deferred, never dropped.
 */
export const MAX_QUEUED_BLOBS = 200;

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
    blobQueue: cursor.blobQueue.slice(0, MAX_QUEUED_BLOBS),
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
export function decodeCursor(raw: string | null): DecodeResult {
  if (raw === null || raw.trim() === "") return { cursor: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A bare string cursor from some earlier shape, or corruption. Either
    // way there is nothing to salvage, so this is a clean restart.
    return { cursor: null, recoveredFrom: "cursor was not JSON" };
  }

  // A JSON document that is merely a string is the legacy bare-cursor shape.
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { cursor: null, recoveredFrom: "cursor was not an object" };
  }

  const candidate = parsed as Record<string, unknown>;

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

  if (candidate.version !== CURSOR_VERSION) {
    return withWatermark(`unknown cursor version ${String(candidate.version)}`);
  }
  if (candidate.phase !== "listing" && candidate.phase !== "draining") {
    return withWatermark(`unknown cursor phase ${String(candidate.phase)}`);
  }
  if (!isIsoDate(candidate.windowStart) || !isIsoDate(candidate.windowEnd)) {
    return withWatermark("cursor window was not a pair of ISO timestamps");
  }
  if (!isStringArray(candidate.blobQueue)) {
    return withWatermark("cursor blobQueue was not a list of strings");
  }
  if (!isIsoDate(candidate.watermark)) {
    return withWatermark("cursor watermark was not an ISO timestamp");
  }

  return {
    cursor: {
      version: CURSOR_VERSION,
      phase: candidate.phase,
      windowStart: candidate.windowStart,
      windowEnd: candidate.windowEnd,
      blobQueue: candidate.blobQueue.slice(0, MAX_QUEUED_BLOBS),
      ...(typeof candidate.nextPageUri === "string"
        ? { nextPageUri: candidate.nextPageUri }
        : {}),
      watermark: candidate.watermark,
    },
  };
}
