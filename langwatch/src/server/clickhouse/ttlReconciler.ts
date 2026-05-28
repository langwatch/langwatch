import { createClient } from "@clickhouse/client";

import { createLogger } from "../../utils/logger/server";
import { parseConnectionUrl } from "./goose";

const logger = createLogger("langwatch:clickhouse:ttl-reconciler");

export interface TableTTLEntry {
  table: string;
  ttlColumn: string;
  /** Override the `toDateTime(ttlColumn)` expression for non-DateTime columns (e.g. UInt64 epoch ms). */
  ttlColumnExpression?: string;
  envVar: string;
  hardcodedDefault: number;
  /**
   * If true, the desired TTL expression is COMBINED: cold-storage
   * MOVE clause + per-class DELETE clauses keyed off RetentionClass.
   * This preserves the per-class retention TTL (migration 00022)
   * when the reconciler runs on cold-storage-enabled installs.
   *
   * Used by stored_spans + stored_log_records, both of which carry
   * the RetentionClass column populated by the trace pipeline write
   * path (3c-ii) from the `langwatch.governance.retention_class`
   * span/log attribute stamped by the receiver.
   *
   * Spec: specs/ai-gateway/governance/retention.feature.
   */
  preservePerClassRetention?: boolean;
  /**
   * Column reference used in the per-class DELETE TTL WHERE expressions.
   * Defaults to ttlColumn. Override for tables where the TTL column is
   * not a Date/DateTime (e.g. stored_log_records uses TimeUnixMs which
   * is already DateTime64 — no override needed).
   */
  retentionTimeColumn?: string;
}

/**
 * Per-class retention windows. Mirrors the IngestionSource.retentionClass
 * enum in Postgres + the migration 00022 TTL clauses. Single source of
 * truth in code; if these change the migration must update too.
 */
const PER_CLASS_RETENTION: ReadonlyArray<{
  className: string;
  intervalSql: string;
}> = [
  { className: "thirty_days", intervalSql: "INTERVAL 30 DAY" },
  { className: "one_year", intervalSql: "INTERVAL 1 YEAR" },
  { className: "seven_years", intervalSql: "INTERVAL 7 YEAR" },
];

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
    envVar: "CLICKHOUSE_COLD_STORAGE_DSPY_STEPS_TTL_DAYS",
    hardcodedDefault: 49,
  },
  {
    table: "evaluation_runs",
    ttlColumn: "UpdatedAt",
    envVar: "CLICKHOUSE_COLD_STORAGE_EVALUATION_RUNS_TTL_DAYS",
    hardcodedDefault: 49,
  },
  {
    table: "event_log",
    ttlColumn: "EventOccurredAt",
    ttlColumnExpression: "toDateTime(EventOccurredAt / 1000)",
    envVar: "CLICKHOUSE_COLD_STORAGE_EVENT_LOG_TTL_DAYS",
    hardcodedDefault: 49,
  },
  {
    table: "experiment_run_items",
    ttlColumn: "OccurredAt",
    envVar: "CLICKHOUSE_COLD_STORAGE_EXPERIMENT_RUN_ITEMS_TTL_DAYS",
    hardcodedDefault: 49,
  },
  {
    table: "experiment_runs",
    ttlColumn: "StartedAt",
    envVar: "CLICKHOUSE_COLD_STORAGE_EXPERIMENT_RUNS_TTL_DAYS",
    hardcodedDefault: 49,
  },
  {
    table: "simulation_runs",
    ttlColumn: "StartedAt",
    envVar: "CLICKHOUSE_COLD_STORAGE_SIMULATION_RUNS_TTL_DAYS",
    hardcodedDefault: 49,
  },
  {
    table: "stored_log_records",
    ttlColumn: "TimeUnixMs",
    envVar: "CLICKHOUSE_COLD_STORAGE_LOG_RECORDS_TTL_DAYS",
    hardcodedDefault: 49,
    preservePerClassRetention: true,
  },
  {
    table: "stored_metric_records",
    ttlColumn: "TimeUnixMs",
    envVar: "CLICKHOUSE_COLD_STORAGE_METRIC_RECORDS_TTL_DAYS",
    hardcodedDefault: 49,
  },
  {
    table: "stored_spans",
    ttlColumn: "EndTime",
    envVar: "CLICKHOUSE_COLD_STORAGE_SPANS_TTL_DAYS",
    hardcodedDefault: 49,
    preservePerClassRetention: true,
    // Per-class DELETE clauses key off StartTime (matches migration 00022).
    retentionTimeColumn: "StartTime",
  },
  {
    table: "trace_summaries",
    ttlColumn: "OccurredAt",
    envVar: "CLICKHOUSE_COLD_STORAGE_TRACE_SUMMARIES_TTL_DAYS",
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
 * Builds the desired TTL SQL expression for a table.
 *
 * For tables with `preservePerClassRetention: true`, emits a combined
 * TTL: cold-storage MOVE clause + 3 per-class DELETE clauses
 * (thirty_days / one_year / seven_years). This is the Option-Y fix
 * for the cold-storage / migration-00022 conflict — the reconciler
 * preserves the per-class DELETE TTL (migration 00022) when applying
 * cold-storage MOVE TTL on cold-storage-enabled installs.
 */
export function buildDesiredTTLExpression({
  config,
  days,
}: {
  config: TableTTLEntry;
  days: number;
}): string {
  const colExpr = config.ttlColumnExpression ?? `toDateTime(${config.ttlColumn})`;
  const coldMoveClause = `${colExpr} + INTERVAL ${days} DAY TO VOLUME 'cold'`;
  if (!config.preservePerClassRetention) {
    return coldMoveClause;
  }
  const retentionTimeCol = config.retentionTimeColumn ?? config.ttlColumn;
  const perClassClauses = PER_CLASS_RETENTION.map(
    ({ className, intervalSql }) =>
      `${retentionTimeCol} + ${intervalSql} DELETE WHERE RetentionClass = '${className}'`,
  );
  return [coldMoveClause, ...perClassClauses].join(", ");
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
  // When called without an explicit connectionUrl (i.e. from production startup),
  // respect the CLICKHOUSE_COLD_STORAGE_ENABLED gate.
  // Direct callers (e.g. integration tests) pass connectionUrl explicitly to bypass.
  if (!options.connectionUrl && process.env.CLICKHOUSE_COLD_STORAGE_ENABLED !== "true") {
    logger.info("CLICKHOUSE_COLD_STORAGE_ENABLED is not set, skipping TTL reconciliation.");
    return;
  }

  const connectionUrl = options.connectionUrl ?? process.env.CLICKHOUSE_URL;
  if (!connectionUrl) {
    logger.info("CLICKHOUSE_URL not configured, skipping TTL reconciliation.");
    return;
  }

  const config = parseConnectionUrl(connectionUrl, options.database);
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
          logger.info(
            { table: tableConfig.table },
            "Table not found, skipping TTL reconciliation",
          );
        }
        continue;
      }

      // TTL volume routing (`TO VOLUME 'cold'`) only works on tables using the
      // tiered storage policy. Tables on 'default' policy don't have a cold volume.
      if (tableInfo.storage_policy !== TIERED_STORAGE_POLICY) {
        if (options.verbose) {
          logger.info(
            { table: tableConfig.table, policy: tableInfo.storage_policy },
            `Table uses '${tableInfo.storage_policy}' policy (not '${TIERED_STORAGE_POLICY}'), skipping TTL`,
          );
        }
        skippedCount++;
        continue;
      }

      const engineFull = tableInfo.engine_full;

      const desiredDays = resolveHotDays(tableConfig);
      const currentDays = parseTTLDaysFromEngineMetadata(engineFull);

      // For per-class-retention tables, also verify the 3 DELETE clauses
      // are present in current engine metadata. If any are missing the
      // table's TTL was clobbered (e.g. by an older reconciler run on a
      // pre-migration-00022 schema) and we need to rebuild.
      const perClassMissing = tableConfig.preservePerClassRetention
        ? !PER_CLASS_RETENTION.every(({ className }) =>
            new RegExp(
              `RetentionClass\\s*=\\s*'${className}'`,
              "i",
            ).test(engineFull),
          )
        : false;

      if (currentDays === desiredDays && !perClassMissing) {
        skippedCount++;
        if (options.verbose) {
          logger.debug(
            { table: tableConfig.table, days: currentDays },
            "TTL already in sync",
          );
        }
        continue;
      }

      const ttlExpr = buildDesiredTTLExpression({
        config: tableConfig,
        days: desiredDays,
      });
      const onCluster = config.clusterName
        ? ` ON CLUSTER \`${config.clusterName}\``
        : "";
      const alterQuery = `ALTER TABLE \`${config.database}\`.\`${tableConfig.table}\`${onCluster} MODIFY TTL ${ttlExpr} SETTINGS materialize_ttl_after_modify = 0`;

      if (options.verbose) {
        logger.info(
          { table: tableConfig.table, from: currentDays, to: desiredDays },
          "Updating TTL",
        );
      }

      await client.command({ query: alterQuery });
      updatedCount++;
    }

    logger.info(
      { updated: updatedCount, skipped: skippedCount },
      "TTL reconciliation complete",
    );
  } finally {
    await client.close();
  }
}
