/**
 * Shared sizing constants for the GQ2 content-addressed blob lifecycle.
 */

/**
 * Backstop TTL for a content-addressed blob, refreshed on access.
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
 * Grace period after lease retirement before blob expires (non-eager reclaim, so
 * bytes stay readable if retaken).
 */
export const BLOB_RELEASE_GRACE_TTL_SECONDS = 60 * 60;

/**
 * Safety margin proving unreferenced blobs are safe to reclaim (distinguishes
 * just-written from abandoned).
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
 * (ADR-026).
 */
export const MAX_BLOB_BYTES = 50 * 1024 * 1024;
