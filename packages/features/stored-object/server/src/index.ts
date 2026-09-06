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
} from "./app/stored-object.app.ts";
export {
  createFilesRestApp,
  isPermissionDenial,
  requiredPermissionForPurpose,
  type FilesDualAuthVariables,
  type FilesProjectPermissionCheck,
  type FilesRateLimiter,
} from "./transport/api-rest/stored-object.api.ts";
export { StoredObjectOwnerLookupRuntimeAdapter } from "./adapters/stored-object-owner-lookup-runtime.adapter.ts";
export {
  StoredObjectDestinationPolicyAdapter,
  StoredObjectAzureDestinationPort,
  StoredObjectProjectS3ConfigPort,
  type StoredObjectStorageSelection,
} from "./adapters/stored-object-destination-policy.adapter.ts";
export {
  StoredObjectStorageRegistryAdapter,
  type StoredObjectStorageDriver,
  type StoredObjectStorageDriverFactory,
} from "./adapters/stored-object-storage-registry.adapter.ts";
export { AzureBlobStoredObjectDriverAdapter } from "./adapters/azure-blob.stored-object-driver.adapter.ts";
export {
  ALLOW_INSECURE_TOKEN_ENDPOINT_ENV,
  AzureBackendMisconfiguredError,
  type AzureBlobCredentialsConfig,
  type AzureCredentials,
  type AzureInjectedIdentity,
  type AzureTokenAuthMode,
} from "./adapters/azure-blob-credentials.adapter.ts";
export { AzureBlobCredentialsAdapter } from "./adapters/azure-blob-credentials.adapter.ts";
export {
  AzureTokenExchangeError,
  type TokenModeCredentials,
} from "./adapters/azure-blob-token-provider.adapter.ts";
export { AzureBlobTokenProviderAdapter } from "./adapters/azure-blob-token-provider.adapter.ts";
export {
  StoredObjectProjectDestinationResolverPort,
  StoredObjectStorageRuntimeAdapter,
  type StoredObjectStorageProject,
  type StoredObjectStorageRuntimeOptions,
} from "./adapters/stored-object-storage-runtime.adapter.ts";
export {
  StoredObjectsPublicApi,
  STORED_OBJECTS_PUBLIC_API_VERSION,
  type StoredObjectsPublicApp,
  type StoredObjectsPublicApiOptions,
} from "./transport/public-rest/stored-object.api.ts";
export {
  ClickHouseImportStoredObjectMigration,
  STORED_OBJECTS_CLICKHOUSE_IMPORT_MIGRATION_NAME,
  type ClickHouseImportStoredObjectMigrationOptions,
} from "./migrations/clickhouse-import.stored-object.migration.ts";
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
} from "./ports/stored-object.port.ts";
export {
  StoredObjectOwnerInstanceDirectoryPort,
  type StoredObjectOwnerClickHouseClient,
  type StoredObjectOwnerClickHouseInstance,
} from "./ports/stored-object-owner-instance-directory.port.ts";
export {
  StoredObjectOwnerLookupTelemetryPort,
  type StoredObjectOwnerLookupSpan,
} from "./ports/stored-object-owner-lookup-telemetry.port.ts";
export {
  StoredObjectService,
  type StoredObjectServiceOptions,
} from "./services/stored-object.service.ts";
export { PostgresStoredObjectAdapter } from "./adapters/postgres.stored-object.adapter.ts";
export {
  StoredObjectTrpcApi,
  type StoredObjectTrpcContext,
} from "./transport/api-trpc/stored-object.api.ts";
/**
 * The CONTENT-ADDRESSED store, moved here whole from the platform application.
 */
export {
  StoredObjectsClickHousePort,
  type StoredObjectsClickHouseClient,
} from "./ports/stored-objects-clickhouse.port.ts";
export { StoredObjectsTelemetryPort } from "./ports/stored-objects-telemetry.port.ts";
export {
  StoredObjectS3TargetPort,
  type StoredObjectS3Credentials,
  type StoredObjectS3Target,
} from "./ports/stored-object-s3-target.port.ts";
export { storedObjectSchema, type StoredObject } from "./rules/stored-object-row.rules.ts";
export {
  StoredObjectsService,
  deriveStoredObjectId,
  type MintStorageUri,
  type StoredObjectsServiceOptions,
} from "./services/stored-objects.service.ts";
export { PrometheusStoredObjectsTelemetryAdapter } from "./adapters/prometheus.stored-objects-telemetry.adapter.ts";
export { LocalFilesystemStoredObjectDriverAdapter } from "./adapters/local-filesystem.stored-object-driver.adapter.ts";
export {
  S3StoredObjectDriverAdapter,
  type StoredObjectS3ClientPolicy,
} from "./adapters/s3.stored-object-driver.adapter.ts";

export {
  auditQueuesForCutover,
  createMigrationTask,
  ObjectStorageMigrateTask,
  parseMigrationTaskConfig,
  type MigrationTaskConfig,
  type MigrationTaskPhase,
} from "./tasks/object-storage-migrate.task.ts";
export { PostgresObjectStorageMigrationInventoryAdapter } from "./adapters/postgres.object-storage-migration-inventory.adapter.ts";
export {
  MigrationBlockedError,
  ObjectStorageMigrationService,
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
} from "./services/object-storage-migration.service.ts";
export {
  MigrationS3StorageDriverAdapter,
  type MigrationS3Configuration,
  type MigrationS3RegionConfiguration,
} from "./adapters/aws.object-storage-migration.adapter.ts";
export {
  MigrationCutoverRedisAuditAdapter,
  type MigrationCutoverRedisConfig,
} from "./adapters/redis.object-storage-migration.adapter.ts";
export {
  GroupQueueObjectStorageMigrationAdapter,
  type QueueAuditRedis,
} from "./adapters/group-queue.object-storage-migration.adapter.ts";
export { PayloadStagingPort, type StagedPayload } from "./ports/payload-staging.port.ts";
export {
  PayloadStagingS3TargetPort,
  S3PayloadStagingAdapter,
  type PayloadStagingS3Target,
} from "./adapters/s3.payload-staging.adapter.ts";
export {
  AbsentPayloadStagingAdapter,
  PayloadStagingUnavailableError,
} from "./adapters/absent.payload-staging.adapter.ts";
