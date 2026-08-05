/**
 * Shared sizing constants for the GQ2 content-addressed blob lifecycle.
 */

/**
 * Backstop TTL for a GQ1 (randomUUID / unshared) offloaded blob. GQ1 blobs
 * are refreshed on the DISPATCHED read only — a staged-but-not-yet-dispatched
 * job (long retry backoff chain, paused pipeline, delayed schedule) has no
 * intervening read between put and TTL tick-down, so this MUST comfortably
 * exceed the longest plausible staged residence — hours, not days. The 7-day
 * value here is the original invariant from `redisJobBlobStore.ts` before
 * ADR-029 was hoisted into this module; see the 2026-06-24 review.
 */
export const GQ1_BLOB_BACKSTOP_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Backstop TTL for a GQ2 content-addressed blob, refreshed on access.
 * Redis expiry is the lazy reclaim mechanism, so a crashed holder that stops
 * renewing cannot leak the blob beyond this window. Four days is the 3-day
 * lease plus a 1-day lazy-reclaim interval, and preserves the existing
 * Friday-to-Monday incident buffer plus a day of catch-up.
 */
export const BLOB_BACKSTOP_TTL_SECONDS = 4 * 24 * 60 * 60;

/**
 * Per-holder lease duration. The blob backstop deliberately outlives this by a
 * day, so command latency can never leave an unexpired lease pointing at a
 * Redis blob whose TTL expired first.
 */
export const BLOB_LEASE_TTL_SECONDS = 3 * 24 * 60 * 60;

/**
 * Lease-set key retention. The extra day lets diagnostics observe recently
 * expired deadlines while every liveness query still prunes them by score.
 */
export const BLOB_LEASE_SET_TTL_SECONDS = BLOB_LEASE_TTL_SECONDS + 24 * 60 * 60;

/**
 * How long a blob survives after its LAST lease is retired.
 *
 * The backstop above is sized for a blob someone is still expected to read — a
 * paused pipeline, a weekend-long retry chain. A blob whose last holder has
 * retired has no such reader, and leaving it on the 4-day backstop meant every
 * dead payload occupied Redis for four days. With no other Redis-tier reclaim
 * path that is not a practical bound: retention simply grows until the oldest
 * blobs age out, and that ceiling was never sized against the instance it has
 * to fit in (2026-07-21).
 *
 * Shortening the expiry is deliberately NOT the eager delete that leases
 * replaced. The bytes stay readable, and any subsequent take re-arms the full
 * backstop, so the release still cannot strip a blob from a producer that wrote
 * these bytes before the release and stages after it — a gap of one Redis round
 * trip, which this window over-covers by orders of magnitude.
 */
export const BLOB_RELEASE_GRACE_TTL_SECONDS = 60 * 60;

/**
 * How long a blob must already have been counting down on the release grace
 * window before the reclaim runner is allowed to DELETE its bytes.
 *
 * `TieredBlobStore.put` writes a blob BEFORE the value that references it is
 * staged, so between those two round trips the bytes carry no lease and no
 * holder. That is indistinguishable, by lease state alone, from a blob nothing
 * will ever reference again — which is exactly the read that made eager reclaim
 * unsafe. The margin is the proof: only the runner's own repair pass puts a blob
 * on the grace window, so a TTL that has fallen this far below it establishes
 * the blob has been unreferenced for at least this long. A just-written blob
 * still carries the full backstop and can never satisfy it.
 */
export const BLOB_RECLAIM_SAFETY_MARGIN_SECONDS = 10 * 60;

/**
 * TTL at or below which the reclaim runner may destroy an unleased blob.
 * Derived so the margin above is the single number to reason about.
 */
export const BLOB_RECLAIM_TTL_THRESHOLD_SECONDS =
  BLOB_RELEASE_GRACE_TTL_SECONDS - BLOB_RECLAIM_SAFETY_MARGIN_SECONDS;

/**
 * How often the reclaim runner sweeps the blob keyspace.
 *
 * Sized against the grace window rather than against traffic: a sweep that lands
 * well inside the window means an unreferenced blob is found, graced, and then
 * destroyed within roughly the window itself, so the practical retention bound
 * for anything nothing references becomes ~1 hour instead of the 4-day backstop.
 */
export const BLOB_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/** Sentinel that prevents previous-release code from observing a last holder. */
export const LEGACY_HOLDER_LEASE_GUARD = "__gq2_lease_guard__";

/**
 * Hard ceiling on a single job's serialized payload. A payload over this is
 * rejected at encode rather than risking an OOM from gzipping + buffering it,
 * and bounds worst-case memory at roughly ceiling × worker concurrency
 * (ADR-030 §1).
 */
export const MAX_BLOB_BYTES = 50 * 1024 * 1024;
