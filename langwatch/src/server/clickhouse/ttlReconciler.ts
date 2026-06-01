import { createClient } from "@clickhouse/client";

import { createLogger } from "../../utils/logger/server";
import { parseConnectionUrl } from "./goose";
import { RETENTION_MANAGED_TABLES } from "../data-retention/retentionPolicy.schema";

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
    retentionTTLColumn: "ScheduledAt",
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
    table: "suite_runs",
    ttlColumn: "StartedAt",
    retentionTTLColumn: "StartedAt",
    envVar: "CLICKHOUSE_COLD_STORAGE_SUITE_RUNS_TTL_DAYS",
    hardcodedDefault: 49,
  },
  {
    table: "stored_metric_records",
    ttlColumn: "TimeUnixMs",
    retentionTTLColumn: "TimeUnixMs",
    envVar: "CLICKHOUSE_COLD_STORAGE_METRIC_RECORDS_TTL_DAYS",
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
  const colExpr = config.ttlColumnExpression ?? `toDateTime(${config.ttlColumn})`;
  return `${colExpr} + INTERVAL ${days} DAY TO VOLUME 'cold'`;
}

export function buildRetentionTTLExpression(config: TableTTLEntry): string | null {
  if (!config.retentionTTLColumn) return null;
  const colExpr =
    config.retentionTTLColumnExpression ??
    `toDateTime(${config.retentionTTLColumn})`;
  return `IF(_retention_days > 0, ${colExpr} + toIntervalDay(_retention_days), toDateTime('${INDEFINITE_RETENTION_SENTINEL_DATE}')) DELETE`;
}

export function hasRetentionTTL(engineFull: string): boolean {
  return engineFull.includes("_retention_days") && engineFull.includes("DELETE");
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
      // tiered storage policy. Tables on 'default' policy don't have a cold volume,
      // but they CAN still have retention DELETE TTL. Likewise, when the operator
      // disables cold-storage management we still need to install retention TTL,
      // so collapse to the retention-only branch in both cases.
      if (tableInfo.storage_policy !== TIERED_STORAGE_POLICY || !coldStorageEnabled) {
        const retentionTTLExpr = buildRetentionTTLExpression(tableConfig);
        if (
          retentionTTLExpr &&
          (RETENTION_MANAGED_TABLES as readonly string[]).includes(tableConfig.table) &&
          !hasRetentionTTL(tableInfo.engine_full)
        ) {
          const onCluster = config.clusterName
            ? ` ON CLUSTER \`${config.clusterName}\``
            : "";
          const alterQuery = `ALTER TABLE \`${config.database}\`.\`${tableConfig.table}\`${onCluster} MODIFY TTL ${retentionTTLExpr} SETTINGS materialize_ttl_after_modify = 0`;
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
      const isManaged = (RETENTION_MANAGED_TABLES as readonly string[]).includes(tableConfig.table);
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

      const onCluster = config.clusterName
        ? ` ON CLUSTER \`${config.clusterName}\``
        : "";
      const alterQuery = `ALTER TABLE \`${config.database}\`.\`${tableConfig.table}\`${onCluster} MODIFY TTL ${ttlClauses} SETTINGS materialize_ttl_after_modify = 0`;

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
