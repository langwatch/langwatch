/**
 * Shared sizing constants for the GQ2 blob lifecycle (ADR-029 / ADR-030 /
 * ADR-046). Hoisted into one module so every collaborator derives its TTLs
 * from a single source — a two-literal drift between, say, the lease and the
 * DLQ retention would silently reopen the DLQ-replay body-loss bug ADR-046
 * closed.
 */

/**
 * Backstop TTL for a GQ1 (randomUUID) offloaded blob. Read-side only since
 * ADR-046 retired GQ1 writes: in-flight GQ1 values keep refreshing this on
 * their dispatched read until they drain out of the system.
 */
export const GQ1_BLOB_BACKSTOP_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Default lease (seconds) on a GQ2 redis-tier blob (ADR-046). Set at PUT,
 * renewed to the full lease on every read (GETEX), effectively renewed by
 * every retry re-encode (an idempotent re-PUT), and extended past itself by
 * the block/DLQ paths. There is no reference counting: when the lease elapses
 * unrefreshed, the blob is gone and a decode terminates at the missing-blob
 * drop path.
 *
 * Deliberately equal to the old refcount-era backstop, so worst-case
 * retention is unchanged by the cutover; retune downward with
 * LANGWATCH_GQ_BLOB_LEASE_SECONDS once a sizing sweep of the `:gq:blob:`
 * keyspace confirms the memory envelope.
 */
export const DEFAULT_BLOB_LEASE_SECONDS = 4 * 24 * 60 * 60;

/**
 * The blob lease, honouring the LANGWATCH_GQ_BLOB_LEASE_SECONDS override.
 * Read at call time (not import time) so operators can retune per-environment
 * and tests can stub process.env without module reloads. Unset / empty /
 * non-numeric / non-positive all fall back to the default — 0 is NOT a kill
 * switch here (a zero-second lease would delete every blob at PUT).
 */
export function readBlobLeaseSeconds(): number {
  const raw = process.env.LANGWATCH_GQ_BLOB_LEASE_SECONDS;
  if (raw === undefined || raw === "") return DEFAULT_BLOB_LEASE_SECONDS;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_BLOB_LEASE_SECONDS;
  return n;
}

/**
 * How long a DLQ'd group's keys (and therefore its blob leases) must survive.
 * The block/DLQ Lua extends each staged value's redis-tier blob lease to at
 * least this (EXPIRE GT), so a replay within the retention window always
 * finds its bodies — the lease may never be SHORTER than the DLQ retention
 * for a value the operator can still replay.
 */
export const DLQ_RETENTION_SECONDS = 7 * 24 * 60 * 60;

/**
 * Hard ceiling on a single job's serialized payload. A payload over this is
 * rejected at encode rather than risking an OOM from gzipping + buffering it,
 * and bounds worst-case memory at roughly ceiling × worker concurrency
 * (ADR-030 §1).
 */
export const MAX_BLOB_BYTES = 50 * 1024 * 1024;
