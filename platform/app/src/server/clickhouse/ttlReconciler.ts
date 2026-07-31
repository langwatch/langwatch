import { createLogger } from "@langwatch/observability";
import { parsePrivateClickHouseUrls } from "~/server/app-layer/clients/clickhouse/private-endpoints";
import {
  getInfrastructureClickHouseClient,
  getSharedAppClickHouseClient,
} from "~/server/app-layer/clients/clickhouse/shared";
import {
  type TenantClickHouseClient,
  tenantClickHouseClient,
} from "~/server/app-layer/clients/clickhouse/tenant-client";
import { RETENTION_MANAGED_TABLES } from "../data-retention/retentionPolicy.schema";
import { parseConnectionUrl } from "./goose";

const logger = createLogger("langwatch:clickhouse:ttl-reconciler");

/** Sentinel date treated as "never expire" — UInt32 epoch limit ~2106. */
const INDEFINITE_RETENTION_SENTINEL_DATE = "2106-01-01";

export interface TableTTLEntry {
  table: string;
  ttlColumn: string;
  /** Override the `toDateTime(ttlColumn)` expression for non-DateTime columns (e.g. UInt64 epoch ms). */
  ttlColumnExpression?: string;
  envVar: string;
  hardcodedDefault: number;
  /** Immutable business-timestamp column for retention TTL (may differ from cold-storage anchor). */
  retentionTTLColumn?: string;
  /** Override for the retention TTL column expression (e.g. for UInt64 epoch ms). */
  retentionTTLColumnExpression?: string;
}

/**
 * Single source of truth for table TTL configuration.
 *
 * Each entry maps a ClickHouse table to:
 * - ttlColumn: the DateTime column used for TTL expiry
 * - envVar: per-table env var override (e.g. CLICKHOUSE_COLD_STORAGE_SPANS_TTL_DAYS=7)
 * - hardcodedDefault: fallback when no env vars are set
 *
 * Resolution order: per-table env var > CLICKHOUSE_COLD_STORAGE_DEFAULT_TTL_DAYS > hardcodedDefault
 */
export const TABLE_TTL_CONFIG: readonly TableTTLEntry[] = [
  {
    table: "billable_events",
    ttlColumn: "EventTimestamp",
    envVar: "CLICKHOUSE_COLD_STORAGE_BILLABLE_EVENTS_TTL_DAYS",
    hardcodedDefault: 49,
  },
  {
    table: "dspy_steps",
    ttlColumn: "CreatedAt",
    retentionTTLColumn: "CreatedAt",
    envVar: "CLICKHOUSE_COLD_STORAGE_DSPY_STEPS_TTL_DAYS",
    hardcodedDefault: 49,
  },
  {
    table: "evaluation_runs",
    ttlColumn: "UpdatedAt",
    // Retention anchors on UpdatedAt (= partition key `toYearWeek(UpdatedAt)`),
    // not ScheduledAt/StartedAt. Both of those are Nullable(DateTime64) on this
    // table and ClickHouse rejects Nullable in TTL expressions with
    // BAD_TTL_EXPRESSION (code 450). UpdatedAt is non-null and partition-aligned,
    // so TTL drops whole weekly partitions at the part level instead of running
    // row-level mutations across still-warm parts.
    retentionTTLColumn: "UpdatedAt",
    envVar: "CLICKHOUSE_COLD_STORAGE_EVALUATION_RUNS_TTL_DAYS",
    hardcodedDefault: 49,
  },
  {
    table: "event_log",
    ttlColumn: "EventOccurredAt",
    ttlColumnExpression: "toDateTime(EventOccurredAt / 1000)",
    retentionTTLColumn: "EventOccurredAt",
    retentionTTLColumnExpression: "toDateTime(EventOccurredAt / 1000)",
    envVar: "CLICKHOUSE_COLD_STORAGE_EVENT_LOG_TTL_DAYS",
    hardcodedDefault: 49,
  },
  {
    table: "langy_analytics_events",
    ttlColumn: "OccurredAt",
    retentionTTLColumn: "OccurredAt",
    envVar: "CLICKHOUSE_COLD_STORAGE_LANGY_ANALYTICS_EVENTS_TTL_DAYS",
    hardcodedDefault: 49,
  },
  {
    table: "experiment_run_items",
    ttlColumn: "OccurredAt",
    retentionTTLColumn: "OccurredAt",
    envVar: "CLICKHOUSE_COLD_STORAGE_EXPERIMENT_RUN_ITEMS_TTL_DAYS",
    hardcodedDefault: 49,
  },
  {
    table: "experiment_runs",
    ttlColumn: "StartedAt",
    retentionTTLColumn: "StartedAt",
    envVar: "CLICKHOUSE_COLD_STORAGE_EXPERIMENT_RUNS_TTL_DAYS",
    hardcodedDefault: 49,
  },
  {
    table: "simulation_runs",
    ttlColumn: "StartedAt",
    retentionTTLColumn: "StartedAt",
    envVar: "CLICKHOUSE_COLD_STORAGE_SIMULATION_RUNS_TTL_DAYS",
    hardcodedDefault: 49,
  },
  {
    table: "stored_log_records",
    ttlColumn: "TimeUnixMs",
    retentionTTLColumn: "TimeUnixMs",
    envVar: "CLICKHOUSE_COLD_STORAGE_LOG_RECORDS_TTL_DAYS",
    hardcodedDefault: 49,
  },
  {
    table: "log_records",
    ttlColumn: "TimeUnixMs",
    retentionTTLColumn: "TimeUnixMs",
    envVar: "CLICKHOUSE_COLD_STORAGE_CANONICAL_LOG_RECORDS_TTL_DAYS",
    hardcodedDefault: 49,
  },
  {
    table: "suite_runs",
    ttlColumn: "StartedAt",
    retentionTTLColumn: "StartedAt",
    envVar: "CLICKHOUSE_COLD_STORAGE_SUITE_RUNS_TTL_DAYS",
    hardcodedDefault: 49,
  },
  {
    table: "metric_data_points",
    ttlColumn: "TimeUnixMs",
    retentionTTLColumn: "TimeUnixMs",
    envVar: "CLICKHOUSE_COLD_STORAGE_METRIC_DATA_POINTS_TTL_DAYS",
    hardcodedDefault: 49,
  },
  {
    table: "metric_series",
    ttlColumn: "LastSeenAt",
    retentionTTLColumn: "LastSeenAt",
    envVar: "CLICKHOUSE_COLD_STORAGE_METRIC_SERIES_TTL_DAYS",
    hardcodedDefault: 49,
  },
  {
    table: "metric_time_rollups",
    ttlColumn: "BucketStart",
    retentionTTLColumn: "BucketStart",
    envVar: "CLICKHOUSE_COLD_STORAGE_METRIC_ROLLUPS_TTL_DAYS",
    hardcodedDefault: 49,
  },
  {
    table: "stored_spans",
    ttlColumn: "EndTime",
    retentionTTLColumn: "StartTime",
    envVar: "CLICKHOUSE_COLD_STORAGE_SPANS_TTL_DAYS",
    hardcodedDefault: 49,
  },
  {
    table: "trace_summaries",
    ttlColumn: "OccurredAt",
    retentionTTLColumn: "OccurredAt",
    envVar: "CLICKHOUSE_COLD_STORAGE_TRACE_SUMMARIES_TTL_DAYS",
    hardcodedDefault: 49,
  },
  // ADR-034 Phase 2: slim per-trace analytics table. Same TTL anchor + cadence
  // as trace_summaries so the slim row ages identically to the row it mirrors.
  {
    table: "trace_analytics",
    ttlColumn: "OccurredAt",
    retentionTTLColumn: "OccurredAt",
    envVar: "CLICKHOUSE_COLD_STORAGE_TRACE_ANALYTICS_TTL_DAYS",
    hardcodedDefault: 49,
  },
  // ADR-034 Phase 1: per-span rollup. Anchor on BucketStart (its sort + partition
  // leaf). BucketStart is DateTime64(3), so the ttlColumnExpression wraps in
  // toDateTime — CH rejects DateTime64 directly in TTL arithmetic.
  {
    table: "trace_analytics_rollup",
    ttlColumn: "BucketStart",
    ttlColumnExpression: "toDateTime(BucketStart)",
    retentionTTLColumn: "BucketStart",
    retentionTTLColumnExpression: "toDateTime(BucketStart)",
    envVar: "CLICKHOUSE_COLD_STORAGE_TRACE_ANALYTICS_ROLLUP_TTL_DAYS",
    hardcodedDefault: 49,
  },
  // ADR-034 Phase 6: slim per-evaluation analytics table. Same TTL anchor +
  // cadence as evaluation_runs so the slim row ages identically.
  {
    table: "evaluation_analytics",
    ttlColumn: "OccurredAt",
    retentionTTLColumn: "OccurredAt",
    envVar: "CLICKHOUSE_COLD_STORAGE_EVALUATION_ANALYTICS_TTL_DAYS",
    hardcodedDefault: 49,
  },
  // ADR-034 Phase 6: per-evaluation rollup. Anchor on BucketStart (its sort +
  // partition leaf). BucketStart is DateTime64(3), so the ttlColumnExpression
  // wraps in toDateTime — CH rejects DateTime64 directly in TTL arithmetic.
  {
    table: "evaluation_analytics_rollup",
    ttlColumn: "BucketStart",
    ttlColumnExpression: "toDateTime(BucketStart)",
    retentionTTLColumn: "BucketStart",
    retentionTTLColumnExpression: "toDateTime(BucketStart)",
    envVar: "CLICKHOUSE_COLD_STORAGE_EVALUATION_ANALYTICS_ROLLUP_TTL_DAYS",
    hardcodedDefault: 49,
  },
] as const;

function parseNonNegativeInt(value: string, label: string): number {
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0) {
    throw new Error(`${label} must be a non-negative integer, got: "${value}"`);
  }
  return num;
}

/**
 * Resolves the desired hot-storage days for a table.
 *
 * Priority:
 * 1. Per-table env var (e.g. CLICKHOUSE_COLD_STORAGE_SPANS_TTL_DAYS)
 * 2. Global default env var (CLICKHOUSE_COLD_STORAGE_DEFAULT_TTL_DAYS)
 * 3. Hardcoded default from TABLE_TTL_CONFIG
 */
export function resolveHotDays(config: TableTTLEntry): number {
  const perTable = process.env[config.envVar];
  if (perTable !== undefined && perTable !== "") {
    return parseNonNegativeInt(perTable, config.envVar);
  }

  const globalDefault = process.env.CLICKHOUSE_COLD_STORAGE_DEFAULT_TTL_DAYS;
  if (globalDefault !== undefined && globalDefault !== "") {
    return parseNonNegativeInt(
      globalDefault,
      "CLICKHOUSE_COLD_STORAGE_DEFAULT_TTL_DAYS",
    );
  }

  return config.hardcodedDefault;
}

/**
 * Parses the TTL interval days from ClickHouse's engine_full metadata string.
 * Returns null if no TTL is set.
 *
 * Example engine_full containing TTL:
 *   "... TTL toDateTime(CreatedAt) + toIntervalDay(2) TO VOLUME 'cold' ..."
 */
export function parseTTLDaysFromEngineMetadata(
  engineFull: string,
): number | null {
  const match = engineFull.match(/toIntervalDay\((\d+)\)/);
  if (!match?.[1]) return null;
  return parseInt(match[1], 10);
}

/**
 * Detects a legacy per-origin retention TTL clause (the removed
 * `RetentionClass`-based DELETE policy). The cold-storage day count alone can
 * match the desired value while these DELETE clauses still linger, so any table
 * carrying them must be rewritten to the clean MOVE-only expression regardless.
 */
export function hasLegacyRetentionTTL(engineFull: string): boolean {
  return /RetentionClass/i.test(engineFull);
}

/**
 * Decides whether a table's TTL needs rewriting. A rewrite is required when the
 * cold-storage day count differs from desired, OR when the current expression
 * still carries a legacy retention DELETE clause that must be stripped.
 */
export function shouldRewriteTTL({
  currentDays,
  desiredDays,
  engineFull,
}: {
  currentDays: number | null;
  desiredDays: number;
  engineFull: string;
}): boolean {
  if (hasLegacyRetentionTTL(engineFull)) return true;
  return currentDays !== desiredDays;
}

/**
 * Builds the desired TTL SQL expression for a table.
 */
export function buildDesiredTTLExpression({
  config,
  days,
}: {
  config: TableTTLEntry;
  days: number;
}): string {
  const colExpr =
    config.ttlColumnExpression ?? `toDateTime(${config.ttlColumn})`;
  return `${colExpr} + INTERVAL ${days} DAY TO VOLUME 'cold'`;
}

export function buildRetentionTTLExpression(
  config: TableTTLEntry,
): string | null {
  if (!config.retentionTTLColumn) return null;
  const colExpr =
    config.retentionTTLColumnExpression ??
    `toDateTime(${config.retentionTTLColumn})`;
  return `IF(_retention_days > 0, ${colExpr} + toIntervalDay(_retention_days), toDateTime('${INDEFINITE_RETENTION_SENTINEL_DATE}')) DELETE`;
}

export function hasRetentionTTL(engineFull: string): boolean {
  // ClickHouse normalizes a bare-DateTime TTL to an implicit DELETE and drops
  // the keyword from stored metadata, so engine_full reads e.g.
  //   TTL if(_retention_days > 0, toDateTime(StartTime) + toIntervalDay(_retention_days), ...)
  // with no "DELETE". Matching on "DELETE" therefore gives a permanent
  // false-negative, making the reconciler re-issue ALTER MODIFY TTL on every
  // run. The `_retention_days` reference is the unique, reliable marker — it
  // only appears inside the TTL expression (engine_full never lists columns).
  return engineFull.includes("_retention_days");
}

interface ReconcileOptions {
  connectionUrl?: string;
  database?: string;
  verbose?: boolean;
}

interface TableEngineInfo {
  name: string;
  engine_full: string;
  storage_policy: string;
}

/**
 * The storage policy that has hot/cold tiered volumes.
 * Tables using this policy can have `TO VOLUME 'cold'` TTL expressions.
 * Tables using 'default' or other policies cannot — TTL is skipped for them.
 */
export const TIERED_STORAGE_POLICY = "local_primary";

/**
 * The routing string the reconciler passes as `tenantId`.
 *
 * It acts on the deployment rather than on a tenant, and the endpoint has
 * already been chosen by {@link resolveEndpointClient}, so this only names the
 * bulkhead slot the DDL occupies and labels its metrics. Borrowing a real
 * tenant's id would queue schema work against that customer's reads and report
 * it as theirs.
 */
const TTL_RECONCILER_ROUTING_KEY = "__ttl_reconciler__";

/**
 * The client for the endpoint a connection URL names.
 *
 * Only two endpoints can be meant, and both are already reachable through the
 * one client the deployment builds: `CLICKHOUSE_URL` — the shared endpoint —
 * and any organisation pinned to its own by `CLICKHOUSE_URL__<label>__<orgId>`.
 * A private URL is matched back to the organisation that declared it and
 * resolved through the same router every other caller routes on, rather than by
 * standing up a second client configured differently from the first (ADR-104
 * §1).
 *
 * Anything else is refused rather than connected to: this runs DDL, and a URL
 * the deployment never declared is not an endpoint whose schema we should be
 * rewriting. The refusal never quotes the URL — a ClickHouse connection URL
 * carries the endpoint's credentials.
 */
function resolveEndpointClient(connectionUrl: string): TenantClickHouseClient {
  const bind = (
    client: Parameters<typeof tenantClickHouseClient>[0]["client"],
  ) => tenantClickHouseClient({ client, tenantId: TTL_RECONCILER_ROUTING_KEY });

  if (connectionUrl === process.env.CLICKHOUSE_URL) {
    const shared = getInfrastructureClickHouseClient();
    if (!shared) {
      throw new Error(
        "Cannot reconcile TTL: no ClickHouse client is available in this process.",
      );
    }
    return bind(shared);
  }

  // The private endpoints are resolved through the shared client's router, so
  // this deployment has to have one. A deployment that declares only private
  // endpoints and no CLICKHOUSE_URL cannot reach them from here.
  if (!process.env.CLICKHOUSE_URL) {
    throw new Error(
      "Cannot reconcile TTL on a private ClickHouse endpoint: CLICKHOUSE_URL is not set, so this process has no client to route through.",
    );
  }

  const organizationId = [...parsePrivateClickHouseUrls()].find(
    ([, url]) => url === connectionUrl,
  )?.[0];
  const app = getSharedAppClickHouseClient();
  if (!app || organizationId === undefined) {
    throw new Error(
      "Cannot reconcile TTL: the connection URL matches neither CLICKHOUSE_URL nor any organisation's CLICKHOUSE_URL__ endpoint.",
    );
  }

  return bind(app.resolveClient(organizationId));
}

/**
 * Reconciles TTL settings for all managed ClickHouse tables.
 *
 * Compares current TTL (from system.tables metadata) against desired values
 * (from env vars / defaults), and issues ALTER TABLE MODIFY TTL only when they differ.
 * Handles tables with no TTL set (fresh installs) by applying the desired TTL.
 *
 * Uses SET materialize_ttl_after_modify = 0 to make changes metadata-only (cheap).
 */
export async function reconcileTTL(
  options: ReconcileOptions = {},
): Promise<void> {
  const connectionUrl = options.connectionUrl ?? process.env.CLICKHOUSE_URL;
  if (!connectionUrl) {
    logger.info("CLICKHOUSE_URL not configured, skipping TTL reconciliation.");
    return;
  }

  // The cold-storage MOVE clause is operator-managed and only meaningful on
  // tiered-storage tables. The DELETE-by-_retention_days clause is the
  // platform's retention enforcement and must run on every deployment, or
  // ingestion stamps `_retention_days` but nothing ever deletes. Gate the
  // tiered-storage rewrite on the env flag; let retention TTL always reconcile.
  const coldStorageEnabled =
    process.env.CLICKHOUSE_COLD_STORAGE_ENABLED === "true";

  const config = parseConnectionUrl(connectionUrl, options.database);
  // The process-wide client, never closed here: it is shared with every other
  // caller on this endpoint, so reconciliation borrows it rather than standing
  // up and tearing down a connection of its own.
  const client = resolveEndpointClient(connectionUrl);

  // Fetch current engine metadata + storage policy for all managed tables
  const tableNames = TABLE_TTL_CONFIG.map((c) => c.table);
  const rows = await client.query<TableEngineInfo>({
    table: "system.tables",
    sql: `SELECT name, engine_full, storage_policy FROM system.tables WHERE database = {database:String} AND name IN {tables:Array(String)}`,
    params: { database: config.database, tables: tableNames },
  });

  const tableInfoByName = new Map(rows.map((r) => [r.name, r]));

  let updatedCount = 0;
  let skippedCount = 0;

  for (const tableConfig of TABLE_TTL_CONFIG) {
    const tableInfo = tableInfoByName.get(tableConfig.table);
    if (!tableInfo) {
      if (options.verbose) {
        logger.info(
          { table: tableConfig.table },
          "Table not found, skipping TTL reconciliation",
        );
      }
      continue;
    }

    // TTL volume routing (`TO VOLUME 'cold'`) only works on tables using the
    // tiered storage policy. Tables on 'default' policy don't have a cold volume,
    // but they CAN still have retention DELETE TTL. Likewise, when the operator
    // disables cold-storage management we still need to install retention TTL,
    // so collapse to the retention-only branch in both cases.
    if (
      tableInfo.storage_policy !== TIERED_STORAGE_POLICY ||
      !coldStorageEnabled
    ) {
      const retentionTTLExpr = buildRetentionTTLExpression(tableConfig);
      if (
        retentionTTLExpr &&
        (RETENTION_MANAGED_TABLES as readonly string[]).includes(
          tableConfig.table,
        ) &&
        !hasRetentionTTL(tableInfo.engine_full)
      ) {
        // No ON CLUSTER: whenever a cluster is configured the database uses
        // the Replicated engine (enforced in goose.ts), which auto-replicates
        // DDL to every replica via Keeper. Adding ON CLUSTER on a table inside
        // a Replicated DB is rejected: "It's not initial query. ON CLUSTER is
        // not allowed for Replicated database (INCORRECT_QUERY)".
        const alterQuery = `ALTER TABLE \`${config.database}\`.\`${tableConfig.table}\` MODIFY TTL ${retentionTTLExpr} SETTINGS materialize_ttl_after_modify = 0`;
        if (options.verbose) {
          logger.info(
            { table: tableConfig.table },
            "Applying retention-only TTL (no cold storage)",
          );
        }
        // `SETTINGS materialize_ttl_after_modify = 0` stays inside the
        // statement rather than moving to `settings`: a statement-level
        // setting and a request-level one are not the same thing, and the
        // inline form is the one known to make this ALTER metadata-only.
        await client.command({
          table: tableConfig.table,
          sql: alterQuery,
        });
        updatedCount++;
      } else {
        if (options.verbose) {
          logger.info(
            { table: tableConfig.table, policy: tableInfo.storage_policy },
            `Table uses '${tableInfo.storage_policy}' policy (not '${TIERED_STORAGE_POLICY}'), skipping cold-storage TTL`,
          );
        }
        skippedCount++;
      }
      continue;
    }

    const engineFull = tableInfo.engine_full;

    const desiredDays = resolveHotDays(tableConfig);
    const currentDays = parseTTLDaysFromEngineMetadata(engineFull);

    const retentionTTLExpr = buildRetentionTTLExpression(tableConfig);
    const isManaged = (RETENTION_MANAGED_TABLES as readonly string[]).includes(
      tableConfig.table,
    );
    // Whether the cold TTL alone is enough to skip this run — i.e. nothing
    // has changed in the cold-TTL space. For managed tables we must still
    // run when retention TTL is missing from the table (first-time apply).
    const retentionMissing =
      isManaged && retentionTTLExpr && !hasRetentionTTL(engineFull);

    if (
      !shouldRewriteTTL({ currentDays, desiredDays, engineFull }) &&
      !retentionMissing
    ) {
      skippedCount++;
      if (options.verbose) {
        logger.debug(
          { table: tableConfig.table, days: currentDays },
          "TTL already in sync",
        );
      }
      continue;
    }

    const coldTTLExpr = buildDesiredTTLExpression({
      config: tableConfig,
      days: desiredDays,
    });

    // MODIFY TTL replaces the whole expression atomically, so for managed
    // tables we ALWAYS re-emit retentionTTLExpr — even when it's already
    // present — otherwise a hot-days bump silently drops the retention
    // DELETE clause from the table.
    const ttlClauses = [
      coldTTLExpr,
      isManaged && retentionTTLExpr ? retentionTTLExpr : null,
    ]
      .filter(Boolean)
      .join(",\n  ");

    // No ON CLUSTER — see note in the retention-only branch above: a
    // Replicated DB auto-replicates this DDL, and ON CLUSTER on a table inside
    // it is rejected with INCORRECT_QUERY.
    const alterQuery = `ALTER TABLE \`${config.database}\`.\`${tableConfig.table}\` MODIFY TTL ${ttlClauses} SETTINGS materialize_ttl_after_modify = 0`;

    if (options.verbose) {
      logger.info(
        {
          table: tableConfig.table,
          from: currentDays,
          to: desiredDays,
          retentionTTL: isManaged && !!retentionTTLExpr,
        },
        "Updating TTL",
      );
    }

    // Inline SETTINGS again — see the retention-only branch above.
    await client.command({ table: tableConfig.table, sql: alterQuery });
    updatedCount++;
  }

  logger.info(
    { updated: updatedCount, skipped: skippedCount },
    "TTL reconciliation complete",
  );
}
