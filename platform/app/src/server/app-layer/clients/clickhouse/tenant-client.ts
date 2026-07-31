/**
 * The application's view of `@langwatch/clickhouse`'s client: one tenant's
 * reads and writes, in the shape hand-written SQL uses.
 *
 * This is what replaced `resilient-client.ts`. That module wrapped the raw
 * `@clickhouse/client` driver and added a retry loop, error translation,
 * logging, metrics and the convention gate on top of it. The retry loop is
 * gone — retry is a property of the package client now, and it applies to
 * inserts only (ADR-104 §3 as amended, ADR-109 decision 4). Everything else
 * survives, and lives here, because none of it was ever about resilience:
 *
 *   - `max_bytes_before_external_group_by`, which used to be bolted on by a
 *     `Proxy` around `.query` (`safeClickhouseClient.ts`) that silently did not
 *     cover `.insert` and that one of the two construction paths forgot
 *     entirely.
 *   - `date_time_input_format: "best_effort"`, which was a construction-time
 *     setting on all three legacy clients and is now stated per operation, so
 *     it cannot be lost by building a client a different way.
 *   - the convention gate, still counting rather than refusing.
 *   - `clickhouse_query_duration_seconds` / `clickhouse_query_total`, which
 *     production dashboards read.
 *   - the three handled-error translations (memory, timeout, unavailable).
 *   - `queryWindowed`, unchanged, as a method so repositories keep calling it
 *     without a cast.
 *
 * Binding the tenant into the object, rather than passing it per call, is the
 * one deliberate shape change. The package client takes `tenantId` on every
 * operation because it routes and bulkheads on it; every call site here got
 * that id from the same place a line earlier, and a per-call parameter is a
 * parameter that can be forgotten or crossed with another request's. Resolving
 * a tenant produces a client that can only act as that tenant.
 *
 * `TenantId` still has to appear in the SQL. Routing is not authorisation —
 * see `tenantRouting.ts`'s note on why a misrouted query that kept its
 * predicate fails safe and one that dropped it discloses.
 */

import type { ClickHouseClient, WriteTarget } from "@langwatch/clickhouse";
import { createLogger } from "@langwatch/observability";
import {
  incrementClickHouseQueryCount,
  incrementConventionViolation,
  observeClickHouseQueryDuration,
} from "~/server/clickhouse/metrics";
import {
  CONVENTION_GATE_THROWS,
  findConventionViolations,
} from "./convention-gate";
import { translateClickHouseQueryError } from "./translate-query-error";
import { queryWindowed } from "./windowed-read";
import { decodeWireRows } from "./wire-rows";

const logger = createLogger("langwatch:clickhouse:tenant-client");
const queryLogger = createLogger("langwatch:clickhouse:query");

/**
 * Settings every read carries unless the caller overrides them.
 *
 * `max_bytes_before_external_group_by` caps how much a `GROUP BY` may hold in
 * memory before spilling to disk, so one large aggregation degrades instead of
 * failing and taking the server's memory with it. `date_time_input_format`
 * governs how a `DateTime` value in `params` is parsed; the driver-based
 * clients set it at construction, and reads that pass an ISO-8601 timestamp
 * parameter depend on it.
 */
const DEFAULT_QUERY_SETTINGS: Record<string, string | number> = {
  max_bytes_before_external_group_by: 500_000_000,
  date_time_input_format: "best_effort",
};

/**
 * Settings every write carries. The package client merges its own durability
 * settings on top of these, so they add to a write without weakening it.
 */
const DEFAULT_INSERT_SETTINGS: Record<string, string | number> = {
  date_time_input_format: "best_effort",
};

export interface TenantQuery {
  readonly sql: string;
  readonly params?: Record<string, unknown>;
  readonly settings?: Record<string, string | number>;
  /** Table label for the duration/count metrics. Defaults to `"unknown"`. */
  readonly table?: string;
}

export interface TenantInsert {
  readonly table: string;
  /**
   * Object rows, in the shape the SQL-era call sites already build.
   *
   * Typed `object` rather than `Record<string, unknown>` on purpose. TypeScript
   * gives an implicit index signature to an anonymous object type but never to
   * an `interface`, so a repository that declares its write record as an
   * `interface` — which most of them do, because it is the natural way to write
   * down a table's shape — would fail to assign here for a reason that has
   * nothing to do with the data. The alternative was asking a dozen files to
   * change `interface` to `type` to satisfy a signature; the columns are read
   * with `Object.keys` at runtime either way, so the narrower type bought
   * nothing it did not also cost.
   */
  readonly rows: readonly object[];
  /**
   * The engine behind `table`, which is what decides whether a failed write
   * may be re-sent (ADR-109 decision 4). Required rather than defaulted: a
   * default would be a guess about someone else's table, and the two possible
   * guesses are "duplicate the row" and "never retry anything".
   */
  readonly target: WriteTarget;
  /**
   * Column order for the positional wire format. Defaults to the union of the
   * keys across `rows`, which is what a caller building uniform rows wants;
   * pass it explicitly when the rows are not uniform.
   */
  readonly columns?: readonly string[];
  readonly settings?: Record<string, string | number>;
}

/**
 * One tenant's ClickHouse. Every method is already scoped to that tenant for
 * routing and concurrency; the SQL still carries `TenantId`.
 */
export interface TenantClickHouseClient {
  /** The tenant this client acts as. Read by callers that build SQL params. */
  readonly tenantId: string;
  query<T>(request: TenantQuery): Promise<T[]>;
  insert(request: TenantInsert): Promise<void>;
  /**
   * A statement that returns no rows — `ALTER … DELETE`, `ALTER … UPDATE`,
   * `OPTIMIZE`, `KILL MUTATION`. Never retried (ADR-109 decision 4).
   *
   * Being tenant-bound does not scope the statement. A mutation needs its own
   * `WHERE TenantId = …` more than a read does: a read that forgets it shows
   * one tenant another's rows, and a mutation that forgets it deletes them.
   */
  command(request: TenantCommand): Promise<void>;
  queryWindowed: typeof queryWindowed;
}

export interface TenantCommand {
  readonly sql: string;
  readonly params?: Record<string, unknown>;
  readonly settings?: Record<string, string | number>;
  /** Table label for the duration/count metrics. Defaults to `"unknown"`. */
  readonly table?: string;
}

/** Resolves a tenant to the client that serves it. */
export type ClickHouseClientResolver = (
  tenantId: string,
) => Promise<TenantClickHouseClient>;

/**
 * Counts the conventions a read breaks, before it is sent.
 *
 * Before rather than after, for the reason the gate has always given: a read
 * that fails is the one most likely to have been unprunable, and a gate that
 * is eventually allowed to refuse has to refuse before the cost is paid.
 *
 * Counting only — this throws only when {@link CONVENTION_GATE_THROWS} is on,
 * which it is nowhere by default. Wrapped so a fault in the checker can never
 * fail a customer's query: the check is advisory, the read is the product.
 */
function countConventionViolations(sql: string, table: string): void {
  try {
    const violations = findConventionViolations(sql);
    if (violations.length === 0) return;

    for (const violation of violations) {
      incrementConventionViolation(violation.table, violation.rule);
    }

    queryLogger.warn(
      {
        source: "clickhouse",
        operation: "query",
        table,
        conventionViolations: violations,
      },
      `ClickHouse convention violation: ${violations
        .map(({ table: t, rule }) => `${t} ${rule}`)
        .join(", ")}`,
    );

    if (CONVENTION_GATE_THROWS) {
      throw new Error(
        `ClickHouse query breaks a convention: ${violations
          .map(({ table: t, rule }) => `${t} ${rule}`)
          .join(", ")}`,
      );
    }
  } catch (error) {
    if (CONVENTION_GATE_THROWS) throw error;
    logger.error({ error }, "Failed to check ClickHouse query conventions");
  }
}

/**
 * The column order for a positional insert: every key any row carries, in the
 * order they were first seen.
 *
 * The union rather than the first row's keys, because a row that omits an
 * optional field would otherwise drop every later row's value for it — the
 * columns list is what maps cell position to column, so a column missing from
 * it is a column no row can write. A row that has no value for a column in the
 * union sends `null`, which is what an object-format insert of the same rows
 * did for a `Nullable` column and what a non-nullable column will now reject
 * loudly instead of silently defaulting.
 */
function unionColumns(rows: readonly object[]): readonly string[] {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (seen.has(key)) continue;
      seen.add(key);
      columns.push(key);
    }
  }
  return columns;
}

function toPositionalRows(
  rows: readonly object[],
  columns: readonly string[],
): unknown[][] {
  return rows.map((row) =>
    columns.map((column) => {
      const value = (row as Record<string, unknown>)[column];
      return value === undefined ? null : value;
    }),
  );
}

async function runQuery<T>(args: {
  client: ClickHouseClient;
  tenantId: string;
  request: TenantQuery;
}): Promise<T[]> {
  const { client, tenantId, request } = args;
  const table = request.table ?? "unknown";
  countConventionViolations(request.sql, table);

  const start = performance.now();
  try {
    const result = await client.query({
      tenantId,
      sql: request.sql,
      params: request.params,
      settings: { ...DEFAULT_QUERY_SETTINGS, ...request.settings },
    });
    const durationMs = performance.now() - start;
    observeClickHouseQueryDuration("SELECT", table, durationMs / 1000);
    incrementClickHouseQueryCount("SELECT", "success");
    queryLogger.debug(
      { source: "clickhouse", operation: "query", table, durationMs },
      "ClickHouse query succeeded",
    );
    return decodeWireRows<T>(result);
  } catch (error) {
    const durationMs = performance.now() - start;
    observeClickHouseQueryDuration("SELECT", table, durationMs / 1000);
    incrementClickHouseQueryCount("SELECT", "error");
    queryLogger.error(
      { source: "clickhouse", operation: "query", table, durationMs, error },
      "ClickHouse query failed",
    );
    // The read is not retried, so this is the only attempt: translate the three
    // failures a caller can act on into handled errors and let everything else
    // through as unknown (ADR-045). The raw error rides in `reasons`, which is
    // where the job-level classifiers unwrap it.
    throw translateClickHouseQueryError(error, durationMs);
  }
}

async function runInsert(args: {
  client: ClickHouseClient;
  tenantId: string;
  request: TenantInsert;
}): Promise<void> {
  const { client, tenantId, request } = args;
  if (request.rows.length === 0) return;

  const columns = request.columns ?? unionColumns(request.rows);
  const start = performance.now();
  const observe = (outcome: "success" | "error") => {
    const durationMs = performance.now() - start;
    observeClickHouseQueryDuration("INSERT", request.table, durationMs / 1000);
    incrementClickHouseQueryCount("INSERT", outcome);
    return durationMs;
  };

  try {
    await client.insert({
      tenantId,
      table: request.table,
      rows: toPositionalRows(request.rows, columns),
      columns,
      target: request.target,
      settings: { ...DEFAULT_INSERT_SETTINGS, ...request.settings },
    });
    observe("success");
  } catch (error) {
    const durationMs = observe("error");
    queryLogger.error(
      {
        source: "clickhouse",
        operation: "insert",
        table: request.table,
        durationMs,
        error,
      },
      "ClickHouse insert failed",
    );
    // Deliberately untranslated. An insert has no customer waiting on it and no
    // remediation to offer one; its caller is a worker whose retry classifier
    // reads the raw error.
    throw error;
  }
}

/**
 * Binds one tenant to the shared package client.
 *
 * `client` is the pool that serves this tenant's target — resolved once, by
 * the composition root's router — and is shared with every other tenant on
 * that same target, which is why the tenant id travels into each call rather
 * than into the pool.
 */
export function tenantClickHouseClient(args: {
  client: ClickHouseClient;
  tenantId: string;
}): TenantClickHouseClient {
  const { client, tenantId } = args;

  return {
    tenantId,
    query: (request) => runQuery({ client, tenantId, request }),
    insert: (request) => runInsert({ client, tenantId, request }),
    command: (request) => runCommand({ client, tenantId, request }),
    queryWindowed,
  };
}

async function runCommand(args: {
  client: ClickHouseClient;
  tenantId: string;
  request: TenantCommand;
}): Promise<void> {
  const { client, tenantId, request } = args;
  const table = request.table ?? "unknown";
  const start = performance.now();
  try {
    await client.command({
      tenantId,
      sql: request.sql,
      params: request.params,
      settings: request.settings,
    });
    observeClickHouseQueryDuration(
      "OTHER",
      table,
      (performance.now() - start) / 1000,
    );
    incrementClickHouseQueryCount("OTHER", "success");
  } catch (error) {
    const durationMs = performance.now() - start;
    observeClickHouseQueryDuration("OTHER", table, durationMs / 1000);
    incrementClickHouseQueryCount("OTHER", "error");
    queryLogger.error(
      {
        source: "clickhouse",
        operation: "command",
        table,
        durationMs,
        error,
      },
      "ClickHouse command failed",
    );
    // Untranslated, like an insert: a mutation's caller is an ops path or a
    // retention job, not a customer waiting on a screen.
    throw error;
  }
}
