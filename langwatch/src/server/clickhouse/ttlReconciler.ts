import { type ClickHouseClient, createClient } from "@clickhouse/client";

import { createLogger } from "../../utils/logger/server";
import { parseConnectionUrl } from "./goose";

const logger = createLogger("langwatch:clickhouse:ttl-reconciler");

export interface TableTTLEntry {
  table: string;
  ttlColumn: string;
  envVar: string;
  hardcodedDefault: number;
}

/**
 * Single source of truth for table TTL configuration.
 *
 * Each entry maps a ClickHouse table to:
 * - ttlColumn: the DateTime column used for TTL expiry
 * - envVar: per-table env var override (e.g. TIERED_STORED_SPANS_TABLE_HOT_DAYS=7)
 * - hardcodedDefault: fallback when no env vars are set
 *
 * Resolution order: per-table env var > TIERED_STORAGE_DEFAULT_HOT_DAYS > hardcodedDefault
 */
export const TABLE_TTL_CONFIG: readonly TableTTLEntry[] = [
  {
    table: "event_log",
    ttlColumn: "CreatedAt",
    envVar: "TIERED_EVENT_LOG_TABLE_HOT_DAYS",
    hardcodedDefault: 30,
  },
  {
    table: "stored_spans",
    ttlColumn: "EndTime",
    envVar: "TIERED_STORED_SPANS_TABLE_HOT_DAYS",
    hardcodedDefault: 30,
  },
  {
    table: "trace_summaries",
    ttlColumn: "LastUpdatedAt",
    envVar: "TIERED_TRACE_SUMMARIES_TABLE_HOT_DAYS",
    hardcodedDefault: 30,
  },
  {
    table: "evaluation_runs",
    ttlColumn: "UpdatedAt",
    envVar: "TIERED_EVALUATION_RUNS_TABLE_HOT_DAYS",
    hardcodedDefault: 30,
  },
  {
    table: "experiment_runs",
    ttlColumn: "CreatedAt",
    envVar: "TIERED_BATCH_EVAL_RUNS_TABLE_HOT_DAYS",
    hardcodedDefault: 30,
  },
  {
    table: "experiment_run_items",
    ttlColumn: "CreatedAt",
    envVar: "TIERED_BATCH_EVAL_RESULTS_TABLE_HOT_DAYS",
    hardcodedDefault: 30,
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
 * 1. Per-table env var (e.g. TIERED_STORED_SPANS_TABLE_HOT_DAYS)
 * 2. Global default env var (TIERED_STORAGE_DEFAULT_HOT_DAYS)
 * 3. Hardcoded default from TABLE_TTL_CONFIG
 */
export function resolveHotDays(config: TableTTLEntry): number {
  const perTable = process.env[config.envVar];
  if (perTable !== undefined && perTable !== "") {
    return parseNonNegativeInt(perTable, config.envVar);
  }

  const globalDefault = process.env.TIERED_STORAGE_DEFAULT_HOT_DAYS;
  if (globalDefault !== undefined && globalDefault !== "") {
    return parseNonNegativeInt(
      globalDefault,
      "TIERED_STORAGE_DEFAULT_HOT_DAYS",
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
 */
export function buildDesiredTTLExpression({
  config,
  days,
}: {
  config: TableTTLEntry;
  days: number;
}): string {
  return `toDateTime(${config.ttlColumn}) + INTERVAL ${days} DAY TO VOLUME 'cold'`;
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
  // respect the ENABLE_CLICKHOUSE feature gate — same as runMigrations.
  // Direct callers (e.g. integration tests) pass connectionUrl explicitly to bypass.
  if (!options.connectionUrl && process.env.ENABLE_CLICKHOUSE !== "true") {
    logger.info("ENABLE_CLICKHOUSE is not set, skipping TTL reconciliation.");
    return;
  }

  if (!options.connectionUrl && process.env.ENABLE_CLICKHOUSE_TTL !== "true") {
    logger.info("ENABLE_CLICKHOUSE_TTL is not set, skipping TTL reconciliation.");
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

      if (currentDays === desiredDays) {
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
