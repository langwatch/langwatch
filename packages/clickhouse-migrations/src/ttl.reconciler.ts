import { createClient } from "@clickhouse/client";
import { RETENTION_TTL_MANAGED_TABLES } from "@langwatch/data-retention-contract/retention-tables";
import { createLogger } from "@langwatch/observability";

import { parseConnectionUrl } from "./goose.migration-runner.ts";

const logger = createLogger("langwatch:clickhouse:ttl-reconciler");

/** Sentinel date treated as "never expire" — UInt32 epoch limit ~2106. */
const INDEFINITE_RETENTION_SENTINEL_DATE = "2106-01-01";

export interface TableTTLEntry {
  table: string;
  ttlColumn: string;
  /** Override the `toDateTime(ttlColumn)` expression for non-DateTime columns (e.g. epoch ms). */
  ttlColumnExpression?: string;
  envVar: string;
  hardcodedDefault: number;
  /** Immutable timestamp column for retention TTL (may differ from the cold-storage anchor). */
  retentionTTLColumn?: string;
  /** Override for the retention TTL column expression (e.g. for UInt64 epoch ms). */
  retentionTTLColumnExpression?: string;
}

/**
 * Single source of truth for table TTL configuration. Resolution order: per-table
 * env var > CLICKHOUSE_COLD_STORAGE_DEFAULT_TTL_DAYS > hardcodedDefault.
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
    // Anchors on UpdatedAt, not ScheduledAt/StartedAt: those are
    // Nullable(DateTime64), and ClickHouse rejects Nullable in TTL
    // expressions (BAD_TTL_EXPRESSION). UpdatedAt is partition-aligned, so
    // TTL drops whole weekly partitions instead of row-level mutations.
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
  // ADR-128: reaches the reconciler via INDEFINITE_DEFAULT_RETENTION_TABLES,
  // not the customer retention cascade, so `_retention_days` defaults to 0
  // and nothing expires unless deliberately stamped. The 49-day cold-storage
  // `MOVE` clause below is still safe — MOVE relocates parts, deletes nothing.
  {
    table: "governance_cost_rollup_1d",
    ttlColumn: "Day",
    ttlColumnExpression: "toDateTime(Day)",
    retentionTTLColumn: "Day",
    retentionTTLColumnExpression: "toDateTime(Day)",
    envVar: "CLICKHOUSE_COLD_STORAGE_GOVERNANCE_COST_ROLLUP_TTL_DAYS",
    hardcodedDefault: 49,
  },
  {
    table: "governance_cost_rollup_restatement_index",
    ttlColumn: "Day",
    ttlColumnExpression: "toDateTime(Day)",
    retentionTTLColumn: "Day",
    retentionTTLColumnExpression: "toDateTime(Day)",
    envVar: "CLICKHOUSE_COLD_STORAGE_GOVERNANCE_COST_ROLLUP_RESTATEMENT_INDEX_TTL_DAYS",
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

const DEFAULT_HOT_DAYS_VARIABLE = "CLICKHOUSE_COLD_STORAGE_DEFAULT_TTL_DAYS";

/** Every variable `resolveHotDays` reads: each table's own, then the global default. */
export const HOT_DAYS_VARIABLES: readonly string[] = [
  ...TABLE_TTL_CONFIG.map((entry) => entry.envVar),
  DEFAULT_HOT_DAYS_VARIABLE,
];

/**
 * Resolves hot-storage days for a table: per-table env var, then the global
 * default env var (`CLICKHOUSE_COLD_STORAGE_DEFAULT_TTL_DAYS`), then the
 * hardcoded default in `TABLE_TTL_CONFIG`.
 */
export function resolveHotDays(
  config: TableTTLEntry,
  overrides: Readonly<Record<string, string | undefined>> = {},
): number {
  const perTable = overrides[config.envVar];
  if (perTable !== undefined && perTable !== "") {
    return parseNonNegativeInt(perTable, config.envVar);
  }

  const globalDefault = overrides[DEFAULT_HOT_DAYS_VARIABLE];
  if (globalDefault !== undefined && globalDefault !== "") {
    return parseNonNegativeInt(globalDefault, DEFAULT_HOT_DAYS_VARIABLE);
  }

  return config.hardcodedDefault;
}

/**
 * Parses the TTL interval days from ClickHouse's engine_full metadata string
 * (e.g. `TTL toDateTime(CreatedAt) + toIntervalDay(2) TO VOLUME 'cold'`).
 * Returns null if no TTL is set.
 */
export function parseTTLDaysFromEngineMetadata(engineFull: string): number | null {
  const match = engineFull.match(/toIntervalDay\((\d+)\)/);
  if (!match?.[1]) return null;
  return parseInt(match[1], 10);
}

/**
 * Detects a legacy per-origin retention TTL clause (the removed
 * `RetentionClass`-based DELETE policy). The day count can already match the
 * desired value while these linger, so such a table is rewritten regardless.
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
  const colExpr = config.ttlColumnExpression ?? `toDateTime(${config.ttlColumn})`;
  return `${colExpr} + INTERVAL ${days} DAY TO VOLUME 'cold'`;
}

export function buildRetentionTTLExpression(config: TableTTLEntry): string | null {
  if (!config.retentionTTLColumn) return null;
  const colExpr = config.retentionTTLColumnExpression ?? `toDateTime(${config.retentionTTLColumn})`;
  return `IF(_retention_days > 0, ${colExpr} + toIntervalDay(_retention_days), toDateTime('${INDEFINITE_RETENTION_SENTINEL_DATE}')) DELETE`;
}

export function hasRetentionTTL(engineFull: string): boolean {
  // ClickHouse normalizes a bare-DateTime TTL to an implicit DELETE and drops
  // the keyword from stored metadata, so matching on "DELETE" gives a
  // permanent false-negative. `_retention_days` is the reliable marker — it
  // only appears inside the TTL expression.
  return engineFull.includes("_retention_days");
}

/** Whether this table should get the retention-only TTL rewrite (no cold storage). */
function isRetentionOnlyEligible(
  retentionTTLExpr: string | null,
  tableConfig: TableTTLEntry,
  engineFull: string,
): boolean {
  if (!retentionTTLExpr) return false;
  if (!RETENTION_TTL_MANAGED_TABLES.includes(tableConfig.table)) return false;
  return !hasRetentionTTL(engineFull);
}

interface ReconcileOptions {
  connectionUrl?: string;
  database?: string;
  clusterName?: string;
  /** `CLICKHOUSE_COLD_STORAGE_ENABLED=true`: tiered tables get the cold-storage MOVE clause. */
  coldStorageEnabled?: boolean;
  /** The operator's hot-days overrides, keyed by the variables in `HOT_DAYS_VARIABLES`. */
  hotDayOverrides?: Readonly<Record<string, string | undefined>>;
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
 * Reconciles TTL for all managed tables: compares current TTL (system.tables)
 * against desired values and issues `ALTER TABLE MODIFY TTL` only when they
 * differ, with `materialize_ttl_after_modify = 0` to keep it metadata-only.
 */
export async function reconcileTTL(options: ReconcileOptions = {}): Promise<void> {
  const connectionUrl = options.connectionUrl;
  if (!connectionUrl) {
    logger.info("CLICKHOUSE_URL not configured, skipping TTL reconciliation.");
    return;
  }

  // The cold-storage MOVE clause is operator-managed and only meaningful on
  // tiered-storage tables. The DELETE-by-_retention_days clause is the
  // platform's retention enforcement and must run on every deployment, or
  // ingestion stamps `_retention_days` but nothing ever deletes. Gate the
  // tiered-storage rewrite on the env flag; let retention TTL always reconcile.
  const coldStorageEnabled = options.coldStorageEnabled ?? false;

  const config = parseConnectionUrl(options);
  const client = createClient({ url: config.databaseUrl });

  try {
    // Fetch current engine metadata + storage policy for all managed tables
    const tableNames = TABLE_TTL_CONFIG.map((c) => c.table);
    const result = await client.query({
      query: `SELECT name, engine_full, storage_policy FROM system.tables WHERE database = {database:String} AND name IN {tables:Array(String)}`,
      query_params: { database: config.database, tables: tableNames },
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as TableEngineInfo[];

    const tableInfoByName = new Map(rows.map((r) => [r.name, r]));

    let updatedCount = 0;
    let skippedCount = 0;

    for (const tableConfig of TABLE_TTL_CONFIG) {
      const tableInfo = tableInfoByName.get(tableConfig.table);
      if (!tableInfo) {
        if (options.verbose) {
          logger.debug(
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
      if (tableInfo.storage_policy !== TIERED_STORAGE_POLICY || !coldStorageEnabled) {
        const retentionTTLExpr = buildRetentionTTLExpression(tableConfig);
        if (isRetentionOnlyEligible(retentionTTLExpr, tableConfig, tableInfo.engine_full)) {
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
          await client.command({ query: alterQuery });
          updatedCount++;
        } else {
          if (options.verbose) {
            logger.debug(
              { table: tableConfig.table, policy: tableInfo.storage_policy },
              `Table uses '${tableInfo.storage_policy}' policy (not '${TIERED_STORAGE_POLICY}'), skipping cold-storage TTL`,
            );
          }
          skippedCount++;
        }
        continue;
      }

      const engineFull = tableInfo.engine_full;

      const desiredDays = resolveHotDays(tableConfig, options.hotDayOverrides);
      const currentDays = parseTTLDaysFromEngineMetadata(engineFull);

      const retentionTTLExpr = buildRetentionTTLExpression(tableConfig);
      const carriesRetentionTTL = RETENTION_TTL_MANAGED_TABLES.includes(tableConfig.table);
      // Whether the cold TTL alone is enough to skip this run — i.e. nothing
      // has changed in the cold-TTL space. For a table that carries the
      // retention clause we must still run when the clause is absent from the
      // table (first-time apply).
      const retentionMissing =
        carriesRetentionTTL && retentionTTLExpr && !hasRetentionTTL(engineFull);

      if (!shouldRewriteTTL({ currentDays, desiredDays, engineFull }) && !retentionMissing) {
        skippedCount++;
        if (options.verbose) {
          logger.debug({ table: tableConfig.table, days: currentDays }, "TTL already in sync");
        }
        continue;
      }

      const coldTTLExpr = buildDesiredTTLExpression({
        config: tableConfig,
        days: desiredDays,
      });

      // MODIFY TTL replaces the whole expression atomically, so for a table
      // that carries the retention clause we ALWAYS re-emit retentionTTLExpr —
      // even when it's already present — otherwise a hot-days bump silently
      // drops the retention DELETE clause from the table.
      const ttlClauses = [
        coldTTLExpr,
        carriesRetentionTTL && retentionTTLExpr ? retentionTTLExpr : null,
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
            retentionTTL: carriesRetentionTTL && !!retentionTTLExpr,
          },
          "Updating TTL",
        );
      }

      await client.command({ query: alterQuery });
      updatedCount++;
    }

    logger.info({ updated: updatedCount, skipped: skippedCount }, "TTL reconciliation complete");
  } finally {
    await client.close();
  }
}
