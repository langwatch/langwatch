import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { spawnSync } from "node:child_process";
import * as path from "node:path";

import { createLogger } from "../../utils/logger";

const logger = createLogger("langwatch:clickhouse:migrations");

/**
 * Goose migration wrapper for ClickHouse
 *
 * Bootstrap & Migration Flow:
 * 1. Pre-flight: Validates config, checks connectivity, verifies goose binary
 * 2. Bootstrap: Creates Replicated database and goose_db_version table (if replicated)
 * 3. Migrations: Goose connects to the database and runs migrations
 *
 * This ensures goose_db_version is created with ReplicatedMergeTree engine
 * so migration state is consistent across all cluster nodes.
 *
 * Configuration via environment variables:
 * - CLICKHOUSE_URL: Connection string with database in path (e.g., http://host:8123/dbname)
 * - CLICKHOUSE_CLUSTER: Cluster name for ReplicatedMergeTree (HA with Keeper). If set, enables replication.
 * - TIERED_*_TABLE_HOT_DAYS: TTL configuration for tiered storage (optional, defaults to 2)
 *
 * @see https://github.com/pressly/goose
 */

const MIGRATIONS_DIR = path.join(__dirname, "migrations");
const VALID_DB_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const TTL_ENV_VARS = [
  "TIERED_EVENT_LOG_TABLE_HOT_DAYS",
  "TIERED_PROCESSOR_CHECKPOINTS_TABLE_HOT_DAYS",
  "TIERED_STORED_SPANS_TABLE_HOT_DAYS",
  "TIERED_TRACE_SUMMARIES_TABLE_HOT_DAYS",
] as const;

export interface GooseOptions {
  connectionUrl?: string;
  database?: string; // Optional database override (takes precedence over URL path)
  migrationsDir?: string;
  verbose?: boolean;
}

interface ClickHouseConfig {
  database: string;
  serverUrl: string; // For bootstrap (no database in path)
  databaseUrl: string; // For bootstrap with database context
  gooseConnectionString: string; // HTTP connection string for goose
  clusterName: string | undefined; // If set, enables replication with this cluster name
}

/**
 * Custom error class for migration failures with phase context
 */
export class MigrationError extends Error {
  constructor(
    message: string,
    public readonly phase: "preflight" | "bootstrap" | "verify" | "migrate",
    public readonly cause?: Error
  ) {
    super(message);
    this.name = "MigrationError";
  }
}

async function withClient<T>(
  url: string,
  fn: (client: ClickHouseClient) => Promise<T>
): Promise<T> {
  const client = createClient({ url });
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

function validateIdentifier(name: string, label: string): void {
  if (!VALID_DB_NAME.test(name)) {
    throw new MigrationError(
      `Invalid ${label}: "${name}". Must start with letter/underscore, contain only alphanumeric/underscore.`,
      "preflight"
    );
  }
}

function validateNumericEnvVar(name: string, defaultVal: number): number {
  const val = process.env[name];
  if (!val) return defaultVal;
  const num = parseInt(val, 10);
  if (Number.isNaN(num) || num < 0) {
    throw new MigrationError(
      `${name} must be a non-negative integer, got: "${val}"`,
      "preflight"
    );
  }
  return num;
}

function parseConnectionUrl(connectionUrl?: string, databaseOverride?: string): ClickHouseConfig {
  const url = connectionUrl ?? process.env.CLICKHOUSE_URL;

  if (!url) {
    throw new MigrationError(
      "CLICKHOUSE_URL environment variable is not set",
      "preflight"
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new MigrationError(
      `Invalid CLICKHOUSE_URL: "${url}". Must be a valid URL.`,
      "preflight"
    );
  }

  // Use database override if provided, otherwise extract from URL path
  const database = databaseOverride ?? parsed.pathname.replace(/^\//, "");
  if (!database) {
    throw new MigrationError(
      "Database name must be specified in CLICKHOUSE_URL path (e.g., http://host:8123/langwatch) or via database option",
      "preflight"
    );
  }
  validateIdentifier(database, "database name");

  const clusterName = process.env.CLICKHOUSE_CLUSTER || undefined;
  if (clusterName) {
    validateIdentifier(clusterName, "cluster name");
  }

  // Server URL (no database path) - for bootstrap operations
  const serverParsed = new URL(url);
  serverParsed.pathname = "/";
  const serverUrl = serverParsed.toString();

  // Database URL - for operations on specific database
  const dbParsed = new URL(url);
  dbParsed.pathname = `/${database}`;
  const databaseUrl = dbParsed.toString();

  // Goose connection string - keep HTTP protocol as the NLB only exposes port 8123
  // The clickhouse-go driver supports both http:// and clickhouse:// protocols
  const gooseParsed = new URL(url);
  gooseParsed.pathname = "/";
  gooseParsed.searchParams.set("database", database);

  const gooseConnectionString = gooseParsed.toString();

  return {
    database,
    serverUrl,
    databaseUrl,
    gooseConnectionString,
    clusterName,
  };
}

function checkGooseBinary(): void {
  const result = spawnSync("which", ["goose"], { encoding: "utf-8" });
  if (result.status !== 0) {
    throw new MigrationError(
      "Goose binary not found. Install from https://github.com/pressly/goose",
      "preflight"
    );
  }
}

async function preflight(config: ClickHouseConfig): Promise<void> {
  logger.info("Running pre-flight checks...");

  // Check goose binary exists
  checkGooseBinary();

  // Validate TTL environment variables
  for (const envVar of TTL_ENV_VARS) {
    validateNumericEnvVar(envVar, 2);
  }

  try {
    await withClient(config.serverUrl, async (client) => {
      await client.ping();
      logger.debug("ClickHouse connectivity check passed");
    });
  } catch (error) {
    throw new MigrationError(
      `Cannot connect to ClickHouse at ${config.serverUrl}: ${error instanceof Error ? error.message : String(error)}`,
      "preflight",
      error instanceof Error ? error : undefined
    );
  }

  logger.info("Pre-flight checks passed");
}

interface DatabaseInfo {
  engine: string;
}

async function verifyDatabaseEngine(
  client: ClickHouseClient,
  database: string,
  clusterName: string | undefined
): Promise<void> {
  const result = await client.query({
    query: `SELECT engine FROM system.databases WHERE name = {database:String}`,
    query_params: { database },
    format: "JSONEachRow",
  });

  const rows = (await result.json()) as DatabaseInfo[];

  const firstRow = rows[0];
  if (!firstRow) return;

  const actualEngine = firstRow.engine;

  if (clusterName && !actualEngine.startsWith("Replicated")) {
    throw new MigrationError(
      `Database "${database}" exists with engine "${actualEngine}", but CLICKHOUSE_CLUSTER is set which requires Replicated engine. Manual intervention required: DROP DATABASE ${database}`,
      "verify"
    );
  }

  // Warn if DB is replicated but env var not set (works but may be misconfigured)
  if (!clusterName && actualEngine.startsWith("Replicated")) {
    logger.warn({ database, actualEngine }, "Database is Replicated but CLICKHOUSE_CLUSTER is not set");
  }

  logger.debug({ database, engine: actualEngine }, "Database engine verified");
}

async function executeBootstrapSQL(
  client: ClickHouseClient,
  sql: string,
  verbose?: boolean
): Promise<void> {
  if (verbose) {
    logger.info({ sql }, "Executing bootstrap SQL");
  }
  await client.command({ query: sql });
}

// Must run BEFORE goose so goose_db_version is created with correct engine for replication
async function bootstrapDatabase(
  config: ClickHouseConfig,
  verbose?: boolean
): Promise<void> {
  logger.info(
    { database: config.database, clusterName: config.clusterName },
    "Bootstrapping ClickHouse database"
  );

  // Use a single client for all bootstrap operations to ensure we hit the same node
  // (NLB can route each connection to a different node, causing issues with Replicated DBs)
  await withClient(config.serverUrl, async (client) => {
    await verifyDatabaseEngine(client, config.database, config.clusterName);

    // Create database with appropriate engine
    // For replicated setup, use ON CLUSTER to ensure all nodes register the database
    const databaseEngine = config.clusterName
      ? `ENGINE = Replicated('/clickhouse/databases/${config.database}', '{shard}', '{replica}')`
      : "";
    const onCluster = config.clusterName ? `ON CLUSTER ${config.clusterName}` : "";

    await executeBootstrapSQL(
      client,
      `CREATE DATABASE IF NOT EXISTS ${config.database} ${onCluster} ${databaseEngine}`,
      verbose
    );

    // Verify database was created (Replicated databases require Keeper)
    const dbResult = await client.query({
      query: `SELECT 1 FROM system.databases WHERE name = {database:String}`,
      query_params: { database: config.database },
      format: "JSONEachRow",
    });
    const dbRows = await dbResult.json();

    if (dbRows.length === 0) {
      throw new MigrationError(
        config.clusterName
          ? `Failed to create Replicated database "${config.database}". ClickHouse Keeper may not be configured. Either configure Keeper or unset CLICKHOUSE_CLUSTER for local development.`
          : `Failed to create database "${config.database}".`,
        "bootstrap"
      );
    }

    // Create default.goose_db_version as ReplicatedMergeTree
    // Goose uses the default database for its version table, and we need it replicated
    // Since 'default' database is Atomic (not Replicated), we must specify explicit Keeper paths
    // Schema must match goose's ClickHouse table: https://github.com/pressly/goose
    //
    // Note: We check if the table exists first because CREATE TABLE IF NOT EXISTS
    // can still fail with REPLICA_ALREADY_EXISTS on replicated tables when the
    // ZooKeeper path exists but the local table doesn't (e.g., after node recovery)
    const tableExistsResult = await client.query({
      query: `SELECT 1 FROM system.tables WHERE database = 'default' AND name = 'goose_db_version'`,
      format: "JSONEachRow",
    });
    const tableExists = (await tableExistsResult.json()).length > 0;

    if (!tableExists) {
      if (config.clusterName) {
        // Don't use ON CLUSTER here - create table locally only.
        // Each node creates its own replica when it runs migrations.
        // The {replica} macro ensures unique replica paths in ZooKeeper.
        await executeBootstrapSQL(
          client,
          `CREATE TABLE IF NOT EXISTS default.goose_db_version (
            version_id Int64,
            is_applied UInt8,
            date Date DEFAULT now(),
            tstamp DateTime DEFAULT now()
          ) ENGINE = ReplicatedMergeTree('/clickhouse/tables/{shard}/default/goose_db_version', '{replica}')
          ORDER BY date
          SETTINGS index_granularity = 8192`,
          verbose
        );
      } else {
        await executeBootstrapSQL(
          client,
          `CREATE TABLE IF NOT EXISTS default.goose_db_version (
            version_id Int64,
            is_applied UInt8,
            date Date DEFAULT now(),
            tstamp DateTime DEFAULT now()
          ) ENGINE = MergeTree()
          ORDER BY date
          SETTINGS index_granularity = 8192`,
          verbose
        );
      }
    } else {
      logger.debug("goose_db_version table already exists, skipping creation");
    }
  });

  logger.info("Bootstrap completed");
}

function buildMigrationEnvVars(config: ClickHouseConfig): NodeJS.ProcessEnv {
  // In Replicated databases, use empty args - the DB handles replication automatically
  const vars: Record<string, string | undefined> = {
    // System vars
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USER: process.env.USER,
    SHELL: process.env.SHELL,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    TERM: process.env.TERM,

    // ClickHouse vars
    CLICKHOUSE_DATABASE: config.database,
    CLICKHOUSE_DATABASE_ENGINE: config.clusterName
      ? `ENGINE = Replicated('/clickhouse/databases/${config.database}', '{shard}', '{replica}')`
      : "",
    CLICKHOUSE_ENGINE_MERGETREE: config.clusterName
      ? "ReplicatedMergeTree()"
      : "MergeTree()",
    CLICKHOUSE_ENGINE_REPLACING_PREFIX: config.clusterName
      ? "ReplicatedReplacingMergeTree("
      : "ReplacingMergeTree(",

    // TTL vars
    ...Object.fromEntries(TTL_ENV_VARS.map((v) => [v, process.env[v]])),
  };

  // Filter out undefined values
  return Object.fromEntries(
    Object.entries(vars).filter(([, v]) => v !== undefined)
  ) as NodeJS.ProcessEnv;
}

function logConfig(config: ClickHouseConfig): void {
  logger.info(
    {
      database: config.database,
      clusterName: config.clusterName,
    },
    "ClickHouse migration configuration"
  );
}

function executeGoose(
  command: string,
  config: ClickHouseConfig,
  options: GooseOptions = {}
): string {
  const migrationsDir = options.migrationsDir ?? MIGRATIONS_DIR;
  const envVars = buildMigrationEnvVars(config);

  if (options.verbose) {
    logConfig(config);
    logger.info({ migrationsDir, __dirname }, "Goose migrations directory");
    // Log connection string with password masked
    const maskedConnStr = config.gooseConnectionString.replace(/:([^:@]+)@/, ':***@');
    logger.info({ connectionString: maskedConnStr }, "Goose connection string");
  }

  const args = [
    "-dir",
    migrationsDir,
    "clickhouse",
    config.gooseConnectionString,
    command,
  ];

  if (options.verbose) {
    args.unshift("-v");
  }

  // Always pipe output so we can check for specific messages
  const result = spawnSync("goose", args, {
    encoding: "utf-8",
    stdio: "pipe",
    env: envVars,
  });

  if (result.error) {
    const message = result.error.message.includes("ENOENT")
      ? "Goose binary not found. Install from https://github.com/pressly/goose"
      : result.error.message;
    throw new MigrationError(`Goose migration failed: ${message}`, "migrate");
  }

  const output = [result.stderr, result.stdout].filter(Boolean).join("\n");

  // In verbose mode, print the output
  if (options.verbose) {
    logger.info({ gooseOutput: output, exitCode: result.status }, "Goose output");
  }

  if (result.status !== 0) {
    // "no next version found" means all migrations are already applied - not an error
    if (output.includes("no next version found") ||
        output.includes("no migrations to run")) {
      logger.info("All migrations are already applied");
      return output;
    }

    throw new MigrationError(
      `Goose migration failed:\n${output || "Unknown error"}`,
      "migrate"
    );
  }

  return result.stdout ?? "";
}

export async function migrateUp(options: GooseOptions = {}): Promise<string> {
  const config = parseConnectionUrl(options.connectionUrl, options.database);

  logger.info("Running ClickHouse migrations...");

  // Pre-flight checks
  await preflight(config);

  // Bootstrap creates the database and goose_db_version table with correct engines
  await bootstrapDatabase(config, options.verbose);

  // Run goose migrations
  const result = executeGoose("up", config, options);
  logger.info("ClickHouse migrations completed.");
  return result;
}

export async function migrateDown(options: GooseOptions = {}): Promise<string> {
  const config = parseConnectionUrl(options.connectionUrl, options.database);

  logger.info("Rolling back last ClickHouse migration...");

  // Pre-flight checks (skip bootstrap for down migration)
  await preflight(config);

  const result = executeGoose("down", config, options);
  logger.info("ClickHouse migration rollback completed.");
  return result;
}

export async function migrateReset(options: GooseOptions = {}): Promise<string> {
  const config = parseConnectionUrl(options.connectionUrl, options.database);

  logger.info("Resetting all ClickHouse migrations...");

  // Pre-flight checks (skip bootstrap for reset)
  await preflight(config);

  const result = executeGoose("reset", config, options);
  logger.info("ClickHouse migrations reset completed.");
  return result;
}

export async function getMigrateVersion(
  options: GooseOptions = {}
): Promise<string> {
  const config = parseConnectionUrl(options.connectionUrl, options.database);
  return executeGoose("version", config, options);
}

export async function getMigrateStatus(
  options: GooseOptions = {}
): Promise<string> {
  const config = parseConnectionUrl(options.connectionUrl, options.database);
  return executeGoose("status", config, options);
}

export async function runMigrationsIfConfigured(
  options: GooseOptions = {}
): Promise<void> {
  if (process.env.ENABLE_CLICKHOUSE !== "true") {
    logger.info(
      "ENABLE_CLICKHOUSE is not set, skipping ClickHouse migrations."
    );
    return;
  }

  const connectionUrlStr = options.connectionUrl ?? process.env.CLICKHOUSE_URL;
  if (!connectionUrlStr) {
    logger.info(
      "CLICKHOUSE_URL not configured, skipping ClickHouse migrations."
    );
    return;
  }

  try {
    await migrateUp({
      ...options,
      connectionUrl: connectionUrlStr,
    });
  } catch (error) {
    if (error instanceof MigrationError) {
      logger.error(
        { phase: error.phase, cause: error.cause?.message },
        `ClickHouse migration failed in ${error.phase} phase: ${error.message}`
      );
    } else {
      logger.error({ error }, "Failed to run ClickHouse migrations");
    }
    throw error;
  }
}
