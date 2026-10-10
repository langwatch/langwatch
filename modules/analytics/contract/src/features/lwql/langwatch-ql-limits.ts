/**
 * LangWatchQL ceilings, pinned in one place: input shape (`MAX_LWQL_LENGTH`, shared so every
 * surface agrees what's submittable) and server-side resource limits, read by provisioning's DDL
 * and by the executor's timeout so runtime need not depend on deploy-time provisioning.
 */

/**
 * Longest statement any surface accepts -- a shape ceiling, not a cost one, refusing pathological
 * input before it reaches a parser. One constant, not one per surface: they are not independent,
 * so disagreement lets a statement run but fail to save -- read by a member as losing their work.
 */
export const MAX_LWQL_LENGTH = 50_000;

/**
 * The row cap, in one place: the validator refuses a top-level `LIMIT` above it
 * (`LIMIT_TOO_HIGH`), the service appends it to a statement naming none, and the settings
 * profile pins it server-side as `max_result_rows`.
 */
export const LWQL_MAX_RESULT_ROWS = 10_000;

/** The byte ceiling a finished result may not exceed, pinned server-side as `max_result_bytes`. */
export const LWQL_MAX_RESULT_BYTES = 8_000_000;

/**
 * Ceilings pinned `CONST` by the profile -- belt and braces, not the load-bearing control:
 * `readonly = 1` already rejects almost every setting change. The `CONST` pins survive any
 * future relaxation of `readonly`.
 */
export interface LangWatchQLResourceLimits {
  maxExecutionTimeSeconds: number;
  maxMemoryUsageBytes: number;
  /** Per-query thread ceiling, so one LangWatchQL query cannot saturate the server's cores. */
  maxThreads: number;
  /**
   * How many LangWatchQL queries the shared restricted identity may run at once -- the only
   * ceiling here that is not per-query, since every other bound constrains one statement, not N
   * arriving together. The N+1th concurrent query is refused rather than admitted.
   */
  maxConcurrentQueriesForUser: number;
  /**
   * Scan ceilings, enforced with `read_overflow_mode = 'throw'`: a query that would exceed
   * either bound fails outright rather than returning a silently partial result, the worse
   * failure for an analytics caller. Reaches the caller as `query_scan_limit_exceeded`.
   */
  maxRowsToRead: number;
  maxBytesToRead: number;
  /**
   * Output ceilings, enforced with `result_overflow_mode = 'throw'`: the server-side backstop
   * for the row cap, catching a `LIMIT {n:UInt64}` bound parameter the static validator cannot
   * read. Reaches the caller as `lwql_result_too_large` (TOO_MANY_ROWS_OR_BYTES, 396).
   */
  maxResultRows: number;
  maxResultBytes: number;
}

/**
 * The shipped ceilings. `maxExecutionTimeSeconds`/`maxMemoryUsageBytes` were measured against
 * `clickhouse-server:25.10.2.65`; the rest are order-of-magnitude guesses, set to refuse a
 * runaway query without a realistic one noticing -- proven accepted by the integration suites.
 */
export const DEFAULT_LWQL_RESOURCE_LIMITS: LangWatchQLResourceLimits = {
  maxExecutionTimeSeconds: 10,
  maxMemoryUsageBytes: 1_000_000_000,
  maxThreads: 4,
  maxConcurrentQueriesForUser: 10,
  maxRowsToRead: 1_000_000_000,
  maxBytesToRead: 10_000_000_000,
  maxResultRows: LWQL_MAX_RESULT_ROWS,
  maxResultBytes: LWQL_MAX_RESULT_BYTES,
};
