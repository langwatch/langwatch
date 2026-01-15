import { spawnSync } from "child_process";
import * as path from "path";
import { createLogger } from "../../utils/logger";

const logger = createLogger("langwatch:clickhouse:migrations");

/**
 * Goose migration wrapper for ClickHouse
 *
 * Database Handling:
 * - Database name is extracted from CLICKHOUSE_URL path (e.g., /langwatch)
 * - Connection to ClickHouse is made at the SERVER level (no database in URL)
 * - Database name is passed to migrations via CLICKHOUSE_DATABASE env var
 * - This allows migrations to CREATE DATABASE without connection errors
 *
 * Configuration via environment variables:
 * - CLICKHOUSE_URL: Connection string with database in path (e.g., http://host:8123/dbname)
 * - CLICKHOUSE_REPLICATED: 'true' for ReplicatedMergeTree (HA with Keeper)
 *
 * @see https://github.com/pressly/goose
 */

const MIGRATIONS_DIR = path.join(__dirname, "migrations");

interface GooseOptions {
  database?: string;
  connectionUrl?: string;
  migrationsDir?: string;
  verbose?: boolean;
}

interface ClickHouseConfig {
  database: string;
  connectionString: string;
  replicated: boolean;
}

/**
 * Parse connection URL and extract database name
 *
 * The database name is read from the URL path but is NOT included in the
 * returned connection string. This allows migrations to create the database
 * by connecting at the server level without specifying a database.
 *
 * @param connectionUrl - Optional connection URL, defaults to CLICKHOUSE_URL env var
 * @returns Object with database name and server-level connection string (no database in path)
 */
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

  // Set secure=true for HTTPS connections
  if (parsed.protocol === "https:" && !parsed.searchParams.has("secure")) {
    parsed.searchParams.set("secure", "true");
  }

  // Convert HTTP URL to clickhouse:// protocol for goose
  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    parsed.protocol = "clickhouse:";
  }

  // Strip database from connection URL - connect at server level only
  parsed.pathname = "/";

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

  // Engine patterns - using {database} and {table} macros for unique ZK paths
  // These are built-in ClickHouse macros that auto-substitute the actual names
  const zkPath = "'/clickhouse/tables/{shard}/{database}/{table}', '{replica}'";

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

/**
 * Execute a goose command
 *
 * Parses the database name from either options.database or the connection URL path,
 * then connects to ClickHouse at the server level (without database in URL).
 * The database name is made available to migrations via CLICKHOUSE_DATABASE env var.
 *
 * @param command - Goose command to execute (up, down, status, etc.)
 * @param options - Configuration options including connection URL and database override
 * @returns Standard output from the goose command
 */
function executeGoose(command: string, options: GooseOptions = {}): string {
  // Parse connection URL to extract database and get server-level connection string
  const { database: parsedDatabase, connectionString } = parseConnectionUrl(
    options.connectionUrl,
  );

  // Allow explicit database override, otherwise use parsed value
  const database = options.database ?? parsedDatabase;

  const config = getConfig(database, connectionString);
  const migrationsDir = options.migrationsDir ?? MIGRATIONS_DIR;
  const envVars = buildMigrationEnvVars(config);

  if (options.verbose) {
    logConfig(config);
  }

  // Connection string is already server-level (no database in path)
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
 *
 * The database name will be automatically extracted from the connection URL
 * and the connection will be made at the server level (without database in path).
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

  try {
    migrateUp({
      ...options,
      connectionUrl: connectionUrlStr,
    });
  } catch (error) {
    logger.error({ error }, "Failed to run ClickHouse migrations");
    throw error;
  }
}
