/**
 * LangWatchQL ceilings — the numeric bounds the module pins in one place.
 *
 * Two kinds live here because both are read from more than one seam and neither
 * belongs to a single owner:
 *
 *  - **Input shape** ({@link MAX_LWQL_LENGTH}) — the longest statement any
 *    surface accepts, read by the query endpoint, the workbench and a saved
 *    chart so they cannot disagree on what is submittable.
 *  - **Server-side resource** ({@link LangWatchQLResourceLimits},
 *    {@link DEFAULT_LWQL_RESOURCE_LIMITS}) — the ceilings the settings profile
 *    pins `CONST`, read both by `provisioning/accessModel.ts` (which emits the
 *    profile DDL) and by `executor.ts` (which derives its request timeout from
 *    `maxExecutionTimeSeconds`). Holding them here is what lets the runtime
 *    executor read them without depending on the deploy-time provisioning
 *    modules.
 *
 * Distinct from the SQL-text safety helpers in `./sqlText.ts` (escaping,
 * identifier validation) and from the result ceilings in `./executor.ts` (how
 * much of a finished result is handed back).
 */

/**
 * Longest statement any LangWatchQL surface accepts.
 *
 * A shape ceiling rather than a cost one — the cost ceilings are pinned
 * server-side by the settings profile. It exists so that pathological input is
 * refused before it reaches a parser fed attacker-controlled text, and it sits
 * far above any query the LangWatchQL catalog's analytical shapes produce.
 *
 * One constant rather than one per surface, because the surfaces are not
 * independent: a statement the workbench will run has to be one the workbench
 * can save, and a saved chart has to be one the query endpoint will accept. Two
 * numbers that agree today are two numbers that can disagree later, and the
 * failure that produces — a query that runs but cannot be stored — surfaces to
 * a member as the product losing their work.
 */
export const MAX_LWQL_LENGTH = 50_000;

/**
 * Ceilings pinned `CONST` by the profile.
 *
 * Belt and braces rather than the load-bearing control: `readonly = 1` already
 * rejects *every* setting change except the tenant capability, including
 * settings the profile never mentions. The `CONST` pins survive any future
 * relaxation of `readonly`.
 */
export interface LangWatchQLResourceLimits {
  maxExecutionTimeSeconds: number;
  maxMemoryUsageBytes: number;
  /** Per-query thread ceiling, so one LangWatchQL query cannot saturate the server's cores. */
  maxThreads: number;
  /**
   * How many LangWatchQL queries the shared restricted identity may run at once.
   *
   * The only ceiling here that is not per-query, and the reason it exists: every
   * other bound in this interface constrains a single statement and says nothing
   * about N of them arriving together. Because one identity is shared by every
   * LangWatchQL query, this is an aggregate bound on the whole API's load — the
   * N+1th concurrent query is refused rather than admitted alongside the others.
   */
  maxConcurrentQueriesForUser: number;
  /**
   * Scan ceilings, enforced with `read_overflow_mode = 'throw'`: a query that
   * would read past either bound fails instead of silently returning a partial
   * result — partial data that looks complete is the worse failure for an
   * analytics caller. The breach reaches the caller as a coded
   * `query_scan_limit_exceeded`, mapped from TOO_MANY_ROWS (158) /
   * TOO_MANY_BYTES (307) by
   * `~/server/app-layer/clients/clickhouse/translate-query-error`.
   */
  maxRowsToRead: number;
  maxBytesToRead: number;
}

/**
 * The shipped ceilings.
 *
 * `maxExecutionTimeSeconds` and `maxMemoryUsageBytes` were measured working
 * against `clickhouse/clickhouse-server:25.10.2.65`. The rest — the thread,
 * scan and concurrency ceilings — are conservative order-of-magnitude choices
 * rather than measurements: nothing has profiled where they should sit, and
 * they are set where a runaway query is refused without a realistic analytical
 * one noticing. That every one of them is *accepted* by that server version is
 * proven, by the integration suites provisioning this profile into a container.
 */
export const DEFAULT_LWQL_RESOURCE_LIMITS: LangWatchQLResourceLimits = {
  maxExecutionTimeSeconds: 10,
  maxMemoryUsageBytes: 1_000_000_000,
  maxThreads: 4,
  maxConcurrentQueriesForUser: 10,
  maxRowsToRead: 1_000_000_000,
  maxBytesToRead: 10_000_000_000,
};
