/**
 * ClickHouse schema migrations and storage maintenance, split from `@langwatch/clickhouse-client`
 * so querying processes do not carry the goose child process and SQL files. Imports the client,
 * never the reverse.
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
