import { spawnSync } from "node:child_process";
import * as path from "node:path";

import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:clickhouse:migrations");

/**
 * Goose migration wrapper for ClickHouse: pre-flight validates config and
 * connectivity, bootstrap creates the Replicated database, then goose runs
 * migrations. With `CLICKHOUSE_CLUSTER` set, DDL and data replicate across nodes.
 * @see https://github.com/pressly/goose
 */

const MIGRATIONS_DIR = path.join(import.meta.dirname, "../migrations");
const VALID_DB_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * The MergeTree setting that relaxes ClickHouse 26.0's refusal to create an
 * AggregatingMergeTree column outside the sorting key or an aggregate state.
 * Absent before 26.0 (`UNKNOWN_SETTING`), so only applied where it exists.
 */
const AGGREGATING_DIMENSION_SETTING = "allow_dimensions_outside_sorting_key";

/**
 * The last migration that runs with the setting above relaxed (merged
 * history; migration 00088 is where the affected columns gain their rule).
 * From 00087 on, such a column fails loudly instead of silently accepted.
 */
const LAST_MIGRATION_NEEDING_DIMENSION_COMPAT = 86;

/**
 * `spawnSync` defaults to one megabyte and kills a verbose migration run
 * past it with ENOBUFS, which reads as a failed migration that in fact
 * applied. See specs/clickhouse/migration-output-buffer.feature.
 */
const GOOSE_OUTPUT_MAX_BYTES = 64 * 1024 * 1024;

/**
 * ENOENT means the binary is missing; ENOBUFS means goose printed past
 * {@link GOOSE_OUTPUT_MAX_BYTES} - the message points at the buffer, not
 * the schema, since it says nothing about whether migrations applied.
 */
export function messageForSpawnError(message: string): string {
  if (message.includes("ENOENT")) {
    return "Goose binary not found. Install from https://github.com/pressly/goose";
  }
  if (message.includes("ENOBUFS")) {
    return `Goose printed more than ${GOOSE_OUTPUT_MAX_BYTES} bytes and was cut off, so this run cannot say whether the migrations applied. Re-run it, and raise GOOSE_OUTPUT_MAX_BYTES if it happens again: ${message}`;
  }
  return message;
}

export interface GooseOptions {
  connectionUrl?: string;
  database?: string; // Optional database override (takes precedence over URL path)
  /** `CLICKHOUSE_CLUSTER`, parsed by the caller; set, every engine is Replicated. */
  clusterName?: string;
  /** The system variables goose inherits (PATH, HOME, USER, SHELL, LANG, LC_ALL, TERM). */
  childEnvironment?: Readonly<Record<string, string | undefined>>;
  migrationsDir?: string;
  verbose?: boolean;
}

export const GOOSE_INHERITED_VARIABLES = [
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "LANG",
  "LC_ALL",
  "TERM",
] as const;

export interface ClickHouseConfig {
  database: string;
  serverUrl: string; // For bootstrap (no database in path)
  databaseUrl: string; // For bootstrap with database context
  gooseConnectionString: string; // HTTP connection string for goose
  clusterName: string | undefined; // If set, enables replication with this cluster name
  /** Set during bootstrap: true if the 'local_primary' storage policy exists. */
  hasLocalPrimaryPolicy?: boolean;
  /**
   * Set during bootstrap: true if the server refuses an AggregatingMergeTree
   * column outside the sorting key.
   */
  requiresDimensionCompat?: boolean;
}

/**
 * Custom error class for migration failures with phase context
 */
export class MigrationError extends Error {
  constructor(
    message: string,
    public readonly phase: "preflight" | "bootstrap" | "verify" | "migrate",
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "MigrationError";
  }
}

async function withClient<T>(
  url: string,
  fn: (client: ClickHouseClient) => Promise<T>,
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
      "preflight",
    );
  }
}

export function parseConnectionUrl({
  connectionUrl: url,
  database: databaseOverride,
  clusterName,
}: {
  connectionUrl?: string;
  database?: string;
  clusterName?: string;
}): ClickHouseConfig {
  if (!url) {
    throw new MigrationError("CLICKHOUSE_URL environment variable is not set", "preflight");
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new MigrationError(`Invalid CLICKHOUSE_URL: "${url}". Must be a valid URL.`, "preflight");
  }

  // Use database override if provided, otherwise extract from URL path
  const database = databaseOverride ?? parsed.pathname.replace(/^\//, "");
  if (!database) {
    throw new MigrationError(
      "Database name must be specified in CLICKHOUSE_URL path (e.g., http://host:8123/langwatch) or via database option",
      "preflight",
    );
  }
  validateIdentifier(database, "database name");

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

  // If using https, we must explicitly tell the clickhouse-go driver to use TLS
  if (gooseParsed.protocol === "https:") {
    gooseParsed.searchParams.set("secure", "true");
    // If the URL has a skip_verify parameter, pass it to goose as well
    const skipVerify = parsed.searchParams.get("skip_verify");
    if (skipVerify) {
      gooseParsed.searchParams.set("skip_verify", skipVerify);
    }
  }

  const gooseConnectionString = gooseParsed.toString();

  return {
    database,
    serverUrl,
    databaseUrl,
    gooseConnectionString,
    clusterName: clusterName || undefined,
  };
}

function checkGooseBinary(): void {
  const result = spawnSync("which", ["goose"], { encoding: "utf-8" });
  if (result.status !== 0) {
    throw new MigrationError(
      "Goose binary not found. Install from https://github.com/pressly/goose",
      "preflight",
    );
  }
}

async function preflight(config: ClickHouseConfig): Promise<void> {
  logger.debug("Running pre-flight checks...");

  // Check goose binary exists
  checkGooseBinary();

  try {
    await withClient(config.serverUrl, async (client) => {
      await client.ping();
      logger.debug("ClickHouse connectivity check passed");
    });
  } catch (error) {
    throw new MigrationError(
      `Cannot connect to ClickHouse at ${config.serverUrl}: ${error instanceof Error ? error.message : String(error)}`,
      "preflight",
      error instanceof Error ? error : undefined,
    );
  }

  logger.debug("Pre-flight checks passed");
}

interface DatabaseInfo {
  engine: string;
}

async function verifyDatabaseEngine(
  client: ClickHouseClient,
  database: string,
  clusterName: string | undefined,
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
      "verify",
    );
  }

  // Warn if DB is replicated but env var not set (works but may be misconfigured)
  if (!clusterName && actualEngine.startsWith("Replicated")) {
    logger.warn(
      { database, actualEngine },
      "Database is Replicated but CLICKHOUSE_CLUSTER is not set",
    );
  }

  logger.debug({ database, engine: actualEngine }, "Database engine verified");
}

async function executeBootstrapSQL(
  client: ClickHouseClient,
  sql: string,
  verbose?: boolean,
): Promise<void> {
  if (verbose) {
    logger.debug({ sql }, "Executing bootstrap SQL");
  }
  await client.command({ query: sql });
}

// Must run BEFORE goose so goose_db_version is created with correct engine for replication
async function bootstrapDatabase(config: ClickHouseConfig, verbose?: boolean): Promise<void> {
  logger.debug(
    { database: config.database, clusterName: config.clusterName },
    "Bootstrapping ClickHouse database",
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
      verbose,
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
        "bootstrap",
      );
    }

    // Pre-creates goose_db_version to avoid a race when workers start
    // simultaneously; schema must match goose's own table. For Replicated
    // databases, DDL auto-replicates but data replication needs ReplicatedMergeTree.
    const engine = config.clusterName ? "ReplicatedMergeTree()" : "MergeTree()";
    await executeBootstrapSQL(
      client,
      `CREATE TABLE IF NOT EXISTS ${config.database}.goose_db_version (
        version_id Int64,
        is_applied UInt8,
        date Date DEFAULT now(),
        tstamp DateTime DEFAULT now()
      ) ENGINE = ${engine}
      ORDER BY date
      SETTINGS index_granularity = 8192`,
      verbose,
    );

    // Insert initial version 0 row if table is empty (atomic to avoid TOCTOU race)
    // Goose requires at least one row to determine the starting version.
    // Without this, goose reports "no next version found" on an empty table.
    await executeBootstrapSQL(
      client,
      `INSERT INTO ${config.database}.goose_db_version (version_id, is_applied)
       SELECT 0, 1
       WHERE NOT EXISTS (SELECT 1 FROM ${config.database}.goose_db_version LIMIT 1)`,
      verbose,
    );
  });

  // Check if 'local_primary' storage policy exists on this CH instance.
  // Production CH has it (configured via k8s statefulset XML config).
  // Local dev / bare CH instances don't — migrations use 'default' policy instead.
  await withClient(config.databaseUrl, async (client) => {
    const result = await client.query({
      query: `SELECT policy_name FROM system.storage_policies WHERE policy_name = 'local_primary'`,
      format: "JSONEachRow",
    });
    const rows = await result.json();
    config.hasLocalPrimaryPolicy = rows.length > 0;
    if (!config.hasLocalPrimaryPolicy) {
      logger.debug(
        "Storage policy 'local_primary' not found — migrations will use 'default' policy",
      );
    }
  });

  // Four rollups were created before 00088 with a column outside the sorting
  // key/aggregate state; a new install still replays that merged history. The
  // setting's presence — not a version number — says whether the server enforces this.
  await withClient(config.databaseUrl, async (client) => {
    const result = await client.query({
      query: `SELECT name FROM system.merge_tree_settings WHERE name = {setting:String}`,
      query_params: { setting: AGGREGATING_DIMENSION_SETTING },
      format: "JSONEachRow",
    });
    config.requiresDimensionCompat = (await result.json()).length > 0;
  });

  logger.debug("Bootstrap completed");
}

function buildMigrationEnvVars({
  config,
  childEnvironment = {},
  allowDimensionsOutsideSortingKey = false,
}: {
  config: ClickHouseConfig;
  childEnvironment?: Readonly<Record<string, string | undefined>>;
  /**
   * Append the compatibility setting to every CREATE TABLE. Only the phase
   * that replays migrations up to LAST_MIGRATION_NEEDING_DIMENSION_COMPAT
   * asks for this, and only when the server enforces the check.
   */
  allowDimensionsOutsideSortingKey?: boolean;
}): NodeJS.ProcessEnv {
  // In Replicated databases, use empty args - the DB handles replication automatically
  const vars: Record<string, string | undefined> = {
    ...Object.fromEntries(GOOSE_INHERITED_VARIABLES.map((name) => [name, childEnvironment[name]])),

    // ClickHouse vars
    CLICKHOUSE_DATABASE: config.database,
    CLICKHOUSE_DATABASE_ENGINE: config.clusterName
      ? `ENGINE = Replicated('/clickhouse/databases/${config.database}', '{shard}', '{replica}')`
      : "",
    CLICKHOUSE_ENGINE_MERGETREE: config.clusterName ? "ReplicatedMergeTree()" : "MergeTree()",
    CLICKHOUSE_ENGINE_REPLACING_PREFIX: config.clusterName
      ? "ReplicatedReplacingMergeTree("
      : "ReplacingMergeTree(",
    CLICKHOUSE_ENGINE_AGGREGATING: config.clusterName
      ? "ReplicatedAggregatingMergeTree()"
      : "AggregatingMergeTree()",
    // "1" when table data must go through Replicated engines to reach every
    // replica. Migrations use this to gate statements that are only correct
    // when a single node holds the complete dataset (e.g. carrying rows over
    // from a plain-engine table, whose content is per-replica when clustered).
    CLICKHOUSE_IS_REPLICATED: config.clusterName ? "1" : "0",

    // Settings appended to every CREATE TABLE, after index_granularity:
    // storage policy ('local_primary' if available, else default), plus the
    // compatibility setting, riding the one substitution common to every CREATE TABLE.
    CLICKHOUSE_STORAGE_POLICY_SETTING: [
      config.hasLocalPrimaryPolicy ? ", storage_policy = 'local_primary'" : "",
      allowDimensionsOutsideSortingKey ? `, ${AGGREGATING_DIMENSION_SETTING} = 1` : "",
    ].join(""),
  };

  // Filter out undefined values
  return Object.fromEntries(
    Object.entries(vars).filter(([, v]) => v !== undefined),
  ) as NodeJS.ProcessEnv;
}

function logConfig(config: ClickHouseConfig): void {
  logger.debug(
    {
      database: config.database,
      clusterName: config.clusterName,
    },
    "ClickHouse migration configuration",
  );
}

/**
 * The migration versions goose reports as applied, read from its own output.
 * It prints one `OK   00042_name.sql` line per migration run and nothing when
 * there's nothing to run, so an empty answer here is a no-op boot, not an error.
 */
export function appliedMigrationVersions(output: string): readonly string[] {
  return [...output.matchAll(/^OK\s+(\d+)[^\n]*$/gm)].map((match) => match[1]!);
}

function executeGoose({
  command,
  config,
  options = {},
  allowDimensionsOutsideSortingKey = false,
}: {
  /** The goose command and its arguments, e.g. ["up"] or ["up-to", "86"]. */
  command: string[];
  config: ClickHouseConfig;
  options?: GooseOptions;
  allowDimensionsOutsideSortingKey?: boolean;
}): string {
  const migrationsDir = options.migrationsDir ?? MIGRATIONS_DIR;
  const envVars = buildMigrationEnvVars({
    config,
    childEnvironment: options.childEnvironment,
    allowDimensionsOutsideSortingKey,
  });

  if (options.verbose) {
    logConfig(config);
    logger.debug({ migrationsDir }, "Goose migrations directory");
    // Log connection string with password masked
    const maskedConnStr = config.gooseConnectionString.replace(/:([^:@]+)@/, ":***@");
    logger.debug({ connectionString: maskedConnStr }, "Goose connection string");
  }

  const args = [
    "-dir",
    migrationsDir,
    "-table",
    `${config.database}.goose_db_version`,
    "clickhouse",
    config.gooseConnectionString,
    ...command,
  ];

  if (options.verbose) {
    args.unshift("-v");
  }

  // Always pipe output so we can check for specific messages
  const result = spawnSync("goose", args, {
    encoding: "utf-8",
    stdio: "pipe",
    env: envVars,
    maxBuffer: GOOSE_OUTPUT_MAX_BYTES,
  });

  if (result.error) {
    const message = messageForSpawnError(result.error.message);
    throw new MigrationError(`Goose migration failed: ${message}`, "migrate");
  }

  const output = [result.stderr, result.stdout].filter(Boolean).join("\n");

  // A run that changed the schema is news; the plumbing behind an idle one is
  // not, and printing it on every boot is what buried the line that mattered.
  const applied = appliedMigrationVersions(output);
  if (applied.length > 0) {
    logger.info({ applied: applied.length, versions: applied }, "Applied ClickHouse migrations");
  } else {
    logger.debug({ gooseOutput: output, exitCode: result.status }, "Goose output");
  }

  if (result.status !== 0) {
    // "no next version found" means all migrations are already applied - not an error
    if (output.includes("no next version found")) {
      logger.info("All migrations are already applied");
      return output;
    }
    if (output.includes("no migrations to run")) {
      logger.info("All migrations are already applied");
      return output;
    }

    throw new MigrationError(`Goose migration failed:\n${output || "Unknown error"}`, "migrate");
  }

  return result.stdout ?? "";
}

export async function migrateUp(options: GooseOptions = {}): Promise<string> {
  const config = parseConnectionUrl(options);

  logger.debug("Running ClickHouse migrations...");

  // Pre-flight checks
  await preflight(config);

  // Bootstrap creates the database and goose_db_version table with correct engines
  await bootstrapDatabase(config, options.verbose);

  // Run goose migrations. On a server that enforces the AggregatingMergeTree
  // dimension check, the merged history runs first with the compatibility
  // setting, then everything from 00087 on runs without it. On every other
  // server this is a single pass, exactly as before.
  if (config.requiresDimensionCompat) {
    logger.debug(
      { throughVersion: LAST_MIGRATION_NEEDING_DIMENSION_COMPAT },
      `This ClickHouse enforces ${AGGREGATING_DIMENSION_SETTING}; replaying the migrations that predate 00087 with it relaxed`,
    );
    executeGoose({
      command: ["up-to", String(LAST_MIGRATION_NEEDING_DIMENSION_COMPAT)],
      config,
      options,
      allowDimensionsOutsideSortingKey: true,
    });
  }

  const result = executeGoose({ command: ["up"], config, options });
  logger.info("ClickHouse migrations completed.");
  return result;
}

export async function migrateDown(options: GooseOptions = {}): Promise<string> {
  const config = parseConnectionUrl(options);

  logger.info("Rolling back last ClickHouse migration...");

  // Pre-flight checks (skip bootstrap for down migration)
  await preflight(config);

  const result = executeGoose({ command: ["down"], config, options });
  logger.info("ClickHouse migration rollback completed.");
  return result;
}

export async function migrateReset(options: GooseOptions = {}): Promise<string> {
  const config = parseConnectionUrl(options);

  logger.info("Resetting all ClickHouse migrations...");

  // Pre-flight checks (skip bootstrap for reset)
  await preflight(config);

  const result = executeGoose({ command: ["reset"], config, options });
  logger.info("ClickHouse migrations reset completed.");
  return result;
}

export async function getMigrateVersion(options: GooseOptions = {}): Promise<string> {
  const config = parseConnectionUrl(options);
  return executeGoose({ command: ["version"], config, options });
}

export async function getMigrateStatus(options: GooseOptions = {}): Promise<string> {
  const config = parseConnectionUrl(options);
  return executeGoose({ command: ["status"], config, options });
}

export async function runMigrations(options: GooseOptions = {}): Promise<void> {
  const connectionUrlStr = options.connectionUrl;
  if (!connectionUrlStr) {
    logger.info("CLICKHOUSE_URL not configured, skipping ClickHouse migrations.");
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
        `ClickHouse migration failed in ${error.phase} phase: ${error.message}`,
      );
    } else {
      logger.error({ error }, "Failed to run ClickHouse migrations");
    }
    throw error;
  }
}
