/**
 * Whether a free-text query looks like a trace id. Advisory only: it adds a sentence to an
 * empty result (ADR-164). Restates the platform's trace-id constants; no server code is shared.
 */

/** Hex-only, matching the server's prefix resolver. */
const HEX_ONLY = /^[0-9a-f]+$/i;

/** Shortest hex string worth calling an id; no upper bound (CLI truncates to 20, OTel is 32). */
const MIN_TRACE_ID_LENGTH = 8;

/** The `trace_`-prefixed form the collector accepts (`trace_` + nanoid). */
const PREFIXED_TRACE_ID = /^trace_[A-Za-z0-9_-]{8,}$/;

export function looksLikeTraceId(query: string): boolean {
  const candidate = query.trim();
  if (candidate.includes(" ")) return false;
  if (PREFIXED_TRACE_ID.test(candidate)) return true;
  return HEX_ONLY.test(candidate) && candidate.length >= MIN_TRACE_ID_LENGTH;
}
