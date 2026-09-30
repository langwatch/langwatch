/**
 * Whether a free-text query looks like a trace id.
 *
 * Mirrors the vocabulary the platform's trace service exports — `HEX_ONLY`,
 * `MIN_TRACE_ID_PREFIX_LENGTH` (8) and `FULL_TRACE_ID_LENGTH` (32) in
 * `platform/app/src/server/traces/trace.service.ts`. This package is a
 * standalone published client that reaches the platform over HTTP and shares no
 * server code, so the vocabulary is restated here rather than imported; keep the
 * two in step.
 *
 * Deliberately narrow, and deliberately advisory. `TraceId` is a free-form
 * `String` in ClickHouse and `trace_id` is `z.string()` in the collector
 * contract, so a customer's ids can be `order-12345` and no check over that
 * space can ever be sound. The answer only ever adds a sentence to an empty
 * result — it never changes what the tool does (ADR-132).
 */

/** Hex-only, matching the server's prefix resolver. */
const HEX_ONLY = /^[0-9a-f]+$/i;

/**
 * Shortest hex string worth calling an id. Matches the server's
 * `MIN_TRACE_ID_PREFIX_LENGTH`, which is also the shortest prefix its git-style
 * resolver will attempt. There is deliberately no upper bound: the CLI prints
 * 20-character truncations, OTel ids are 32, and longer ids exist in the wild.
 */
const MIN_TRACE_ID_LENGTH = 8;

/** The `trace_`-prefixed form the collector accepts (`trace_` + nanoid). */
const PREFIXED_TRACE_ID = /^trace_[A-Za-z0-9_-]{8,}$/;

export function looksLikeTraceId(query: string): boolean {
  const candidate = query.trim();
  if (candidate.includes(" ")) return false;
  if (PREFIXED_TRACE_ID.test(candidate)) return true;
  return HEX_ONLY.test(candidate) && candidate.length >= MIN_TRACE_ID_LENGTH;
}
