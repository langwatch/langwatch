/**
 * The installer and the transport declarations the process mounts, beside the
 * ports and adapters the processes that own the byte backends compose.
 */
export { storedObjectServer } from "./stored-object.server.ts";
export {
  STORED_OBJECTS_PUBLIC_API_VERSION,
  storedObjectRest,
} from "./transport/stored-object.rest.ts";
export { storedObjectTrpcTransport } from "./transport/stored-object.trpc.ts";
export {
  StoredObjectApp,
  type StoredObjectFileReader,
  type StoredObjectFileStreamRead,
  type StoredObjectInfrastructure,
} from "./app/stored-object.app.ts";
export {
  FILE_VIEW_PERMISSIONS,
  isPermissionDenial,
  requiredPermissionForPurpose,
  StoredObjectFileApi,
  storedObjectFileRest,
  type FilesProjectPermissionCheck,
  type FilesRateLimiter,
  type StoredObjectFileAllowance,
  type StoredObjectFileCaller,
  type StoredObjectFileViewPermission,
} from "./transport/stored-object-file.rest.ts";
export { ClickhouseStoredObjectOwnerLookupRuntimeRepository as StoredObjectOwnerLookupRuntimeAdapter } from "./repositories/clickhouse/clickhouse.stored-object-owner-lookup-runtime.repository.ts";
export {
  StoredObjectDestinationPolicyAdapter,
  StoredObjectAzureDestination,
  StoredObjectProjectS3Config,
  type StoredObjectStorageSelection,
} from "./services/stored-object-destination-policy.service.ts";
export { StoredObjectStorageRegistryAdapter } from "./services/stored-object-storage-registry.service.ts";
export type {
  StoredObjectStorageDriver,
  StoredObjectStorageDriverFactory,
} from "./repositories/stored-object-blob.repository.ts";
export { StoredObjectStoragePortAdapter } from "./services/stored-object-storage.service.ts";
export { AzureBlobStoredObjectDriverAdapter } from "#repositories/azure/azure.stored-object-blob.repository";
export {
  ALLOW_INSECURE_TOKEN_ENDPOINT_ENV,
  AzureBackendMisconfiguredError,
  AzureBlobCredentialsAdapter,
  type AzureBlobCredentialsConfig,
  type AzureCredentials,
  type AzureInjectedIdentity,
  type AzureTokenAuthMode,
} from "./services/azure-blob-credentials.service.ts";
export {
  AzureBlobTokenProviderAdapter,
  AzureTokenExchangeError,
  type TokenModeCredentials,
} from "./services/azure-blob-token-provider.service.ts";
export {
  StoredObjectProjectDestinationResolver,
  StoredObjectStorageRuntimeAdapter,
  type StoredObjectStorageProject,
  type StoredObjectStorageRuntimeOptions,
} from "./services/stored-object-storage-runtime.service.ts";
export {
  ClickHouseImportStoredObjectMigration,
  STORED_OBJECTS_CLICKHOUSE_IMPORT_MIGRATION_NAME,
  type ClickHouseImportStoredObjectMigrationOptions,
} from "./migrations/clickhouse-import.stored-object.migration.ts";
export {
  StoredObjectDelivery,
  StoredObjectStorage,
  StoredObjectUploadTokenCodec,
  type StoredObjectStorageAddress,
  type StoredObjectUploadTokenClaims,
} from "./app/stored-object.infrastructure.ts";
export { StoredObjectLegacyLocation } from "./repositories/stored-object-legacy-location.repository.ts";
export {
  StoredObjectLegacySource,
  type LegacyStoredObjectRow,
} from "./repositories/stored-object-legacy-source.repository.ts";
export { StoredObjectLegacyWriterDrain } from "./repositories/stored-object-legacy-writer-drain.repository.ts";
export { StoredObjectProjectSource } from "./repositories/stored-object-project-source.repository.ts";
export {
  StoredObjectOwnerInstanceDirectoryRepository as StoredObjectOwnerInstanceDirectory,
  type StoredObjectOwnerClickHouseClient,
  type StoredObjectOwnerClickHouseInstance,
} from "./repositories/stored-object-owner-instance-directory.repository.ts";
export {
  type StoredObjectOwnerLookupTelemetry,
  type StoredObjectOwnerLookupSpan,
} from "./app/stored-object.infrastructure.ts";
/**
 * The CONTENT-ADDRESSED store, moved here whole from the platform application.
 */
export {
  type StoredObjectsClickHouse,
  type StoredObjectsClickHouseClient,
} from "./app/stored-object.infrastructure.ts";
export { type StoredObjectsTelemetry } from "./app/stored-object.infrastructure.ts";
export {
  type StoredObjectS3TargetResolver,
  type StoredObjectS3Credentials,
  type StoredObjectS3Target,
} from "./app/stored-object.infrastructure.ts";
export { storedObjectSchema, type StoredObject } from "./rules/stored-object-row.rules.ts";
export {
  StoredObjectsService,
  deriveStoredObjectId,
  type MintStorageUri,
  type StoredObjectsServiceOptions,
} from "./services/stored-objects.service.ts";
export { PrometheusStoredObjectsTelemetryAdapter } from "./services/prometheus.stored-objects-telemetry.service.ts";
export { StoredObjectBlobFilesystemRepository } from "#repositories/filesystem/filesystem.stored-object-blob.repository";
export {
  StoredObjectBlobS3Repository,
  type StoredObjectS3ClientPolicy,
} from "#repositories/s3/s3.stored-object-blob.repository";

export {
  auditQueuesForCutover,
  createMigrationTask,
  ObjectStorageMigrateTask,
  parseMigrationTaskConfig,
  type MigrationTaskConfig,
  type MigrationTaskPhase,
} from "./tasks/object-storage-migrate.task.ts";
export {
  ObjectStorageMigrationInventory,
  type MigrationDataset,
  type MigrationPageRequest,
  type MigrationProject,
} from "./repositories/object-storage-migration-inventory.repository.ts";
export {
  MigrationBlockedError,
  ObjectStorageMigrationService,
  type MigrationCopyReport,
  type MigrationFinalizeReport,
  type MigrationPlan,
  type MigrationProvider,
  type MigrationStorageEndpoint,
  type QueueMigrationBlocker,
} from "./services/object-storage-migration.service.ts";
export {
  MigrationBlobS3Repository,
  type MigrationS3Configuration,
  type MigrationS3RegionConfiguration,
} from "#repositories/s3/s3.object-storage-migration-blob.repository";
export {
  MigrationCutoverAuditRedisRepository,
  type MigrationCutoverRedisConfig,
} from "#repositories/redis/redis.object-storage-migration-audit.repository";
export {
  GroupQueueObjectStorageMigrationAdapter,
  type QueueAuditRedis,
} from "./services/group-queue.object-storage-migration.service.ts";
export { PayloadStaging, type StagedPayload } from "./repositories/payload-staging.repository.ts";
export {
  PayloadStagingS3TargetRepository,
  S3PayloadStagingAdapter,
  type PayloadStagingS3Target,
} from "#repositories/s3/s3.payload-staging.repository";
export {
  AbsentPayloadStagingAdapter,
  PayloadStagingUnavailableError,
} from "./services/absent-payload-staging.service.ts";
