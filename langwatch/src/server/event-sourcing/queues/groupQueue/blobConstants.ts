/**
 * Shared sizing constants for the GQ2 content-addressed blob lifecycle
 * (ADR-029 / ADR-030). Hoisted into one module so the blob and its holder set
 * derive their TTL from a single source — the holder set must outlive the blob
 * it guards, so a two-literal drift would be a correctness bug.
 */

/**
 * Backstop TTL for a GQ1 (randomUUID / no-refcount) offloaded blob. GQ1 blobs
 * are refreshed on the DISPATCHED read only — a staged-but-not-yet-dispatched
 * job (long retry backoff chain, paused pipeline, delayed schedule) has no
 * intervening read between put and TTL tick-down, so this MUST comfortably
 * exceed the longest plausible staged residence — hours, not days. The 7-day
 * value here is the original invariant from `redisJobBlobStore.ts` before
 * ADR-029 was hoisted into this module; see the 2026-06-24 review.
 */
export const GQ1_BLOB_BACKSTOP_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Backstop TTL for a GQ2 (content-addressed, refcounted) offloaded blob,
 * refreshed on access. The holder-set TTL is set to at least this (see
 * {@link BlobHolders}); both reclaim eagerly on the happy path, so this only
 * bounds genuine orphans — sized at 4 days so a Friday-evening incident still
 * has its blobs on Monday plus a day of catch-up. The GQ2 blob has an
 * accompanying holder set (per-stage tokens with atomic reclaim in Lua), so
 * the window here is the safety net for missed releases (crash mid-
 * completion), not the primary reclaim mechanism.
 */
export const BLOB_BACKSTOP_TTL_SECONDS = 4 * 24 * 60 * 60;

/**
 * TTL on a blob's holder set — deliberately longer than the blob TTL so the
 * holder set always outlives the blob it guards. A holder set that expired
 * first would drop its members and let a still-referenced blob be reclaimed.
 * Both are refreshed on access, so this margin only has to cover the small skew
 * between the two refreshes (ADR-030 §3).
 */
export const BLOB_HOLDER_TTL_SECONDS = BLOB_BACKSTOP_TTL_SECONDS + 24 * 60 * 60;

/**
 * Hard ceiling on a single job's serialized payload. A payload over this is
 * rejected at encode rather than risking an OOM from gzipping + buffering it,
 * and bounds worst-case memory at roughly ceiling × worker concurrency
 * (ADR-030 §1).
 */
export const MAX_BLOB_BYTES = 50 * 1024 * 1024;
