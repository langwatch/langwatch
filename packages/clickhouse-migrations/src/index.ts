/**
 * ClickHouse schema migrations, storage maintenance and the app's access model (ADR-202), split
 * from `@langwatch/clickhouse-client` so querying processes carry neither the goose child process
 * and SQL files nor the identities' DDL. Imports the client, never the reverse.
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
  DIMENSION_COMPAT_PROBE,
  dimensionCompatSettingFor,
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

export {
  renderIdentitiesUsersD,
  renderIdentityDdl,
  yamlDocument,
} from "./access-model/access-identity.ts";
export type {
  AccessGrant,
  AccessIdentity,
  AccessProfileSetting,
  AccessRowPolicy,
  YamlValue,
} from "./access-model/access-identity.ts";

export {
  APP_READER_ENFORCING_NAMES,
  APP_READER_NAMES,
  APP_READER_SETTINGS_PREFIX,
  APP_READER_TENANT_TABLES,
  APP_WRITER_NAMES,
  APP_WRITER_TABLES,
  appReaderEnforcingIdentity,
  appReaderIdentity,
  appWriterIdentity,
  hiddenSystemTablePolicies,
  renderAppReaderDdl,
  renderAppReaderUsersD,
} from "./access-model/app-access-model.ts";
export type { AppAccessModelInput, AppWriterInput } from "./access-model/app-access-model.ts";
