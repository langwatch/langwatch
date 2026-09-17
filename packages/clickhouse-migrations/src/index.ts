/**
 * ClickHouse schema migrations and storage maintenance.
 *
 * Split out of `@langwatch/clickhouse-client` because the two halves have
 * different shapes. The client opens connections and runs queries; this
 * package spawns the `goose` binary as a child process, owns the 87 versioned
 * SQL files on disk beside it, and rewrites TTL expressions on live tables.
 * Keeping them together meant every process that merely queried ClickHouse
 * carried the migration runner's child-process and filesystem surface.
 *
 * The dependency runs one way only: this package imports the client for its
 * tenant routing and schema lock, and the client names nothing here.
 */
export {
  ClickHouseMigrateTask,
  GooseClickHouseMigrationExecutor,
  resolveClickHouseMigrationTaskConfig,
} from "./clickhouse-migrate.task.ts";
export type {
  ClickHouseMigrationEndpoint,
  ClickHouseMigrationTaskConfig,
} from "./clickhouse-migrate.task.ts";

export {
  appliedMigrationVersions,
  getMigrateStatus,
  getMigrateVersion,
  migrateDown,
  migrateReset,
  migrateUp,
  MigrationError,
  parseConnectionUrl,
  runMigrations,
} from "./goose.migration-runner.ts";
export type { ClickHouseConfig, GooseOptions } from "./goose.migration-runner.ts";

export {
  buildDesiredTTLExpression,
  buildRetentionTTLExpression,
  hasLegacyRetentionTTL,
  hasRetentionTTL,
  parseTTLDaysFromEngineMetadata,
  reconcileTTL,
  resolveHotDays,
  shouldRewriteTTL,
  TABLE_TTL_CONFIG,
  TIERED_STORAGE_POLICY,
} from "./ttl.reconciler.ts";
export type { TableTTLEntry } from "./ttl.reconciler.ts";
