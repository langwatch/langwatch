import { spawnSync } from "child_process";
import * as path from "path";
import { createLogger } from "../../utils/logger";

const logger = createLogger("langwatch:clickhouse:migrations");

/**
 * Goose migration wrapper for ClickHouse
 *
 * Configuration via environment variables:
 * - CLICKHOUSE_REPLICATED: 'true' for ReplicatedMergeTree (HA with Keeper)
 *
 * @see https://github.com/pressly/goose
 */

const MIGRATIONS_DIR = path.join(
  process.cwd(),
  "src/server/clickhouse/migrations",
);

interface GooseOptions {
  connectionUrl?: string;
  migrationsDir?: string;
  verbose?: boolean;
}

interface ClickHouseConfig {
  database: string;
  connectionString: string;
  replicated: boolean;
}

function parseConnectionUrl(connectionUrl?: string): {
  database: string;
  connectionString: string;
} {
  const url = connectionUrl ?? process.env.CLICKHOUSE_URL;

  if (!url) {
    throw new Error("CLICKHOUSE_URL environment variable is not set");
  }

  const parsed = new URL(url);
  const database = parsed.pathname.replace(/^\//, "") || "langwatch";

  // Convert HTTP URL to clickhouse:// protocol for goose
  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    parsed.protocol = "clickhouse:";
  }

  return { database, connectionString: parsed.toString() };
}

function getConfig(
  database: string,
  connectionString: string,
): ClickHouseConfig {
  return {
    database,
    connectionString,
    replicated: process.env.CLICKHOUSE_REPLICATED === "true",
  };
}

/**
 * Build environment variables for goose ENVSUB
 *
 * Security: Only passes the minimal set of environment variables needed.
 */
function buildMigrationEnvVars(
  config: ClickHouseConfig,
): Record<string, string | undefined> {
  const systemVars: Record<string, string | undefined> = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USER: process.env.USER,
    SHELL: process.env.SHELL,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    TERM: process.env.TERM,
  };

  // Engine patterns - using {uuid} macro so ClickHouse auto-generates unique ZK paths
  // These are generic building blocks; migrations complete them with version columns
  const zkPath = "'/clickhouse/tables/{uuid}/{shard}', '{replica}'";

  const clickhouseVars: Record<string, string> = {
    CLICKHOUSE_DATABASE: config.database,

    CLICKHOUSE_ENGINE_MERGETREE: config.replicated
      ? `ReplicatedMergeTree(${zkPath})`
      : "MergeTree()",

    // Prefix for ReplacingMergeTree - SQL appends version column and closing paren
    CLICKHOUSE_ENGINE_REPLACING_PREFIX: config.replicated
      ? `ReplicatedReplacingMergeTree(${zkPath}, `
      : "ReplacingMergeTree(",
  };

  return { ...systemVars, ...clickhouseVars };
}

function logConfig(config: ClickHouseConfig): void {
  logger.info(
    {
      database: config.database,
      replicated: config.replicated,
    },
    "ClickHouse migration configuration",
  );
}

function executeGoose(command: string, options: GooseOptions = {}): string {
  const { database, connectionString } = parseConnectionUrl(
    options.connectionUrl,
  );
  const config = getConfig(database, connectionString);
  const migrationsDir = options.migrationsDir ?? MIGRATIONS_DIR;
  const envVars = buildMigrationEnvVars(config);

  if (options.verbose) {
    logConfig(config);
  }

  const args = ["-dir", migrationsDir, "clickhouse", connectionString, command];

  if (options.verbose) {
    args.unshift("-v");
  }

  const result = spawnSync("goose", args, {
    encoding: "utf-8",
    stdio: options.verbose ? "inherit" : "pipe",
    env: envVars as NodeJS.ProcessEnv,
  });

  if (result.error) {
    const message = result.error.message.includes("ENOENT")
      ? "Goose binary not found. Install from https://github.com/pressly/goose"
      : result.error.message;
    throw new Error(`Goose migration failed: ${message}`);
  }

  if (result.status !== 0) {
    throw new Error(
      `Goose migration failed: ${result.stderr || "Unknown error"}`,
    );
  }

  return result.stdout ?? "";
}

export function migrateUp(options: GooseOptions = {}): string {
  logger.info("Running ClickHouse migrations...");
  const result = executeGoose("up", options);
  logger.info("ClickHouse migrations completed.");
  return result;
}

export function migrateDown(options: GooseOptions = {}): string {
  logger.info("Rolling back last ClickHouse migration...");
  const result = executeGoose("down", options);
  logger.info("ClickHouse migration rollback completed.");
  return result;
}

export function migrateReset(options: GooseOptions = {}): string {
  logger.info("Resetting all ClickHouse migrations...");
  const result = executeGoose("reset", options);
  logger.info("ClickHouse migrations reset completed.");
  return result;
}

export function getMigrateVersion(options: GooseOptions = {}): string {
  return executeGoose("version", options);
}

export function getMigrateStatus(options: GooseOptions = {}): string {
  return executeGoose("status", options);
}

/**
 * Run migrations if ENABLE_CLICKHOUSE and CLICKHOUSE_URL are configured
 */
export async function runMigrationsIfConfigured(
  options: GooseOptions = {},
): Promise<void> {
  if (!process.env.ENABLE_CLICKHOUSE) {
    logger.info(
      "ENABLE_CLICKHOUSE is not set, skipping ClickHouse migrations.",
    );
    return;
  }

  const connectionUrlStr = options.connectionUrl ?? process.env.CLICKHOUSE_URL;
  if (!connectionUrlStr) {
    logger.info(
      "CLICKHOUSE_URL not configured, skipping ClickHouse migrations.",
    );
    return;
  }

  const connectionUrlNoDatabase = new URL(connectionUrlStr);
  connectionUrlNoDatabase.pathname = "";

  try {
    migrateUp({ ...options, connectionUrl: connectionUrlNoDatabase.toString() });
  } catch (error) {
    logger.error({ error }, "Failed to run ClickHouse migrations");
    throw error;
  }
}
