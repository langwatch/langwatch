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

/** Sentinel that prevents previous-release code from observing a last holder. */
export const LEGACY_HOLDER_LEASE_GUARD = "__gq2_lease_guard__";

/**
 * Hard ceiling on a single job's serialized payload. A payload over this is
 * rejected at encode rather than risking an OOM from gzipping + buffering it,
 * and bounds worst-case memory at roughly ceiling × worker concurrency
 * (ADR-030 §1).
 */
export const MAX_BLOB_BYTES = 50 * 1024 * 1024;
