import { type ClickHouseClient, createClient } from "@clickhouse/client";

import { createLogger } from "../../utils/logger/server";

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
    table: "evaluation_states",
    ttlColumn: "UpdatedAt",
    envVar: "TIERED_EVALUATION_STATES_TABLE_HOT_DAYS",
    hardcodedDefault: 30,
  },
  {
    table: "experiment_runs",
    ttlColumn: "CreatedAt",
    envVar: "TIERED_BATCH_EVAL_RUNS_TABLE_HOT_DAYS",
    hardcodedDefault: 30,
  },
  {
    table: "experiment_run_results",
    ttlColumn: "CreatedAt",
    envVar: "TIERED_BATCH_EVAL_RESULTS_TABLE_HOT_DAYS",
    hardcodedDefault: 30,
  },
] as const;

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
    const num = parseInt(perTable, 10);
    if (Number.isNaN(num) || num < 0) {
      throw new Error(
        `${config.envVar} must be a non-negative integer, got: "${perTable}"`,
      );
    }
    return num;
  }

  const globalDefault = process.env.TIERED_STORAGE_DEFAULT_HOT_DAYS;
  if (globalDefault !== undefined && globalDefault !== "") {
    const num = parseInt(globalDefault, 10);
    if (Number.isNaN(num) || num < 0) {
      throw new Error(
        `TIERED_STORAGE_DEFAULT_HOT_DAYS must be a non-negative integer, got: "${globalDefault}"`,
      );
    }
    return num;
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
export function buildDesiredTTLExpression(
  config: TableTTLEntry,
  days: number,
): string {
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

  const parsed = new URL(connectionUrl);
  const database = options.database ?? parsed.pathname.replace(/^\//, "");
  if (!database) {
    logger.warn("No database specified, skipping TTL reconciliation.");
    return;
  }

  const clusterName = process.env.CLICKHOUSE_CLUSTER || undefined;

  // Point client at the target database
  const dbParsed = new URL(connectionUrl);
  dbParsed.pathname = `/${database}`;
  const client = createClient({ url: dbParsed.toString() });

  try {
    // Fetch current engine metadata + storage policy for all managed tables
    const tableNames = TABLE_TTL_CONFIG.map((c) => c.table);
    const result = await client.query({
      query: `SELECT name, engine_full, storage_policy FROM system.tables WHERE database = {database:String} AND name IN {tables:Array(String)}`,
      query_params: { database, tables: tableNames },
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as TableEngineInfo[];

    const tableInfoByName = new Map(rows.map((r) => [r.name, r]));

    let updatedCount = 0;
    let skippedCount = 0;

    for (const config of TABLE_TTL_CONFIG) {
      const tableInfo = tableInfoByName.get(config.table);
      if (!tableInfo) {
        if (options.verbose) {
          logger.info(
            { table: config.table },
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
            { table: config.table, policy: tableInfo.storage_policy },
            `Table uses '${tableInfo.storage_policy}' policy (not '${TIERED_STORAGE_POLICY}'), skipping TTL`,
          );
        }
        skippedCount++;
        continue;
      }

      const engineFull = tableInfo.engine_full;

      const desiredDays = resolveHotDays(config);
      const currentDays = parseTTLDaysFromEngineMetadata(engineFull);

      if (currentDays === desiredDays) {
        skippedCount++;
        if (options.verbose) {
          logger.debug(
            { table: config.table, days: currentDays },
            "TTL already in sync",
          );
        }
        continue;
      }

      const ttlExpr = buildDesiredTTLExpression(config, desiredDays);
      const onCluster = clusterName ? ` ON CLUSTER ${clusterName}` : "";
      const alterQuery = `ALTER TABLE ${database}.${config.table}${onCluster} MODIFY TTL ${ttlExpr} SETTINGS materialize_ttl_after_modify = 0`;

      if (options.verbose) {
        logger.info(
          { table: config.table, from: currentDays, to: desiredDays },
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
