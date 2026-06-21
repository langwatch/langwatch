/**
 * Shared sizing constants for the GQ2 content-addressed blob lifecycle
 * (ADR-029 / ADR-030). Hoisted into one module so the blob and its holder set
 * derive their TTL from a single source — the holder set must outlive the blob
 * it guards, so a two-literal drift would be a correctness bug.
 */

/**
 * Backstop TTL for an offloaded blob, refreshed on access. The holder-set TTL is
 * set to at least this (see {@link BlobHolders}); both reclaim eagerly on the
 * happy path, so this only bounds genuine orphans — sized to outlive a weekend.
 */
export const BLOB_BACKSTOP_TTL_SECONDS = 3 * 24 * 60 * 60;

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
