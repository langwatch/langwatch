/**
 * The feature's application: the one typed thing its transports are given.
 * Every door reaches the same object, so a rule written on it is the rule
 * every door gets.
 */
export {
  StoredObjectApp,
  type StoredObjectAppDependencies,
  type StoredObjectFileRead,
  type StoredObjectFileReadPort,
  type StoredObjectFileRow,
  type StoredObjectHead,
} from "./app/stored-object.app";
export {
  createFilesRestApp,
  isPermissionDenial,
  requiredPermissionForPurpose,
  type FilesDualAuthVariables,
  type FilesProjectPermissionCheck,
  type FilesRateLimiter,
} from "./transport/api-rest/stored-object.api";
export { StoredObjectOwnerLookupRuntime } from "./adapters/stored-object-owner-lookup.runtime";
export {
  StoredObjectDestinationPolicy,
  StoredObjectAzureDestinationPort,
  StoredObjectProjectS3ConfigPort,
  type StoredObjectStorageSelection,
} from "./adapters/stored-object-destination.policy";
export {
  StoredObjectStorageRegistry,
  type StoredObjectStorageDriver,
  type StoredObjectStorageDriverFactory,
} from "./adapters/stored-object-storage.registry";
export { AzureBlobStoredObjectDriver } from "./adapters/azure-blob.stored-object-driver.adapter";
export {
  ALLOW_INSECURE_TOKEN_ENDPOINT_ENV,
  AzureBackendMisconfiguredError,
  assertTokenModeTransportSafety,
  resolveAzureCredentials,
  type AzureBlobCredentialsConfig,
  type AzureCredentials,
  type AzureInjectedIdentity,
  type AzureTokenAuthMode,
} from "./adapters/azure-blob-credentials";
export {
  AzureTokenExchangeError,
  getAzureBlobToken,
  invalidateAzureBlobToken,
  resetAzureTokenCacheForTests,
  type TokenModeCredentials,
} from "./adapters/azure-blob-token-provider";
export {
  StoredObjectProjectDestinationResolverPort,
  StoredObjectStorageRuntime,
  type StoredObjectStorageProject,
  type StoredObjectStorageRuntimeOptions,
} from "./adapters/stored-object-storage.runtime";
export {
  StoredObjectsPublicApi,
  STORED_OBJECTS_PUBLIC_API_VERSION,
  type StoredObjectsPublicApp,
  type StoredObjectsPublicApiOptions,
} from "./api/public/stored-object.api";
export {
  ClickHouseImportStoredObjectMigration,
  STORED_OBJECTS_CLICKHOUSE_IMPORT_MIGRATION_NAME,
  type ClickHouseImportStoredObjectMigrationOptions,
} from "./migrations/clickhouse-import.stored-object.migration";
export {
  StoredObjectDeliveryPort,
  StoredObjectLegacyLocationPort,
  StoredObjectLegacySourcePort,
  StoredObjectLegacyWriterDrainPort,
  StoredObjectProjectSourcePort,
  StoredObjectStoragePort,
  StoredObjectUploadTokenPort,
  type LegacyStoredObjectRow,
  type StoredObjectStorageAddress,
  type StoredObjectUploadTokenClaims,
} from "./ports/stored-object.port";
export {
  StoredObjectOwnerInstanceDirectoryPort,
  type StoredObjectOwnerClickHouseClient,
  type StoredObjectOwnerClickHouseInstance,
} from "./ports/stored-object-owner-instance-directory.port";
export {
  StoredObjectOwnerLookupTelemetryPort,
  type StoredObjectOwnerLookupSpan,
} from "./ports/stored-object-owner-lookup-telemetry.port";
export {
  StoredObjectService,
  type StoredObjectServiceOptions,
} from "./services/stored-object.service";
export { PostgresStoredObjectAdapter } from "./adapters/postgres.stored-object.adapter";
export {
  StoredObjectTrpcApi,
  type StoredObjectTrpcContext,
} from "./transport/api-trpc/stored-object.api";
/**
 * The CONTENT-ADDRESSED store, moved here whole from the platform application.
 *
 * Plural where the canonical store above is singular, and the plural is the
 * distinction rather than a typo: `StoredObjectsService` reads and writes the
 * ClickHouse `stored_objects` table every trace attachment, dataset upload and
 * evaluation payload written before the Postgres store still lives in. An
 * object written through one is not readable through the other.
 */
export { ObjectNotFoundError } from "./errors";
export {
  StoredObjectsClickHousePort,
  type StoredObjectsClickHouseClient,
} from "./ports/stored-objects-clickhouse.port";
export { StoredObjectsTelemetryPort } from "./ports/stored-objects-telemetry.port";
export {
  StoredObjectS3TargetPort,
  type StoredObjectS3Credentials,
  type StoredObjectS3Target,
} from "./ports/stored-object-s3-target.port";
export {
  storedObjectSchema,
  type StoredObject,
} from "./repositories/clickhouse/stored-objects.row";
export { StoredObjectsRepository } from "./repositories/clickhouse/stored-objects.repository";
export {
  StoredObjectsService,
  deriveStoredObjectId,
  type MintStorageUri,
  type StoredObjectsServiceOptions,
} from "./services/stored-objects.service";
export { PrometheusStoredObjectsTelemetry } from "./adapters/prometheus.stored-objects-telemetry.adapter";
export { LocalFilesystemStoredObjectDriver } from "./adapters/local-filesystem.stored-object-driver.adapter";
export {
  S3StoredObjectDriver,
  type StoredObjectS3ClientPolicy,
} from "./adapters/s3.stored-object-driver.adapter";

export {
  auditQueuesForCutover,
  createMigrationTask,
  ObjectStorageMigrateTask,
  parseMigrationTaskConfig,
  type MigrationTaskConfig,
  type MigrationTaskPhase,
} from "./tasks/object-storage-migrate.task";
export { createMigrationInventory } from "./adapters/postgres.object-storage-migration-inventory.adapter";
export {
  MigrationBlockedError,
  ObjectStorageMigration,
  createMigrationStorageEndpoint,
  type MigrationCopyReport,
  type MigrationDataset,
  type MigrationFinalizeReport,
  type MigrationInventory,
  type MigrationPageRequest,
  type MigrationPlan,
  type MigrationProject,
  type MigrationProvider,
  type MigrationStorageEndpoint,
  type QueueMigrationBlocker,
} from "./services/object-storage-migration.service";
export {
  MigrationS3StorageDriver,
  resolveMigrationS3Region,
  type MigrationS3Configuration,
  type MigrationS3RegionConfiguration,
} from "./adapters/aws.object-storage-migration.adapter";
export {
  MigrationCutoverRedisAudit,
  type MigrationCutoverRedisConfig,
} from "./adapters/redis.object-storage-migration.adapter";
export {
  auditGroupQueuesForStorageMigration,
  type QueueAuditRedis,
} from "./adapters/group-queue.object-storage-migration.adapter";
