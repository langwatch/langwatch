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
  type StoredObjectFileReadPort,
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
export { StoredObjectOwnerLookupRuntimeAdapter } from "./adapters/stored-object-owner-lookup-runtime.adapter.ts";
export {
  StoredObjectDestinationPolicyAdapter,
  StoredObjectAzureDestinationPort,
  StoredObjectProjectS3ConfigPort,
  type StoredObjectStorageSelection,
} from "./adapters/stored-object-destination-policy.adapter.ts";
export { StoredObjectStorageRegistryAdapter } from "./adapters/stored-object-storage-registry.adapter.ts";
export type {
  StoredObjectStorageDriver,
  StoredObjectStorageDriverFactory,
} from "./repositories/stored-object-blob.repository.ts";
export { StoredObjectStoragePortAdapter } from "./adapters/stored-object-storage.port.adapter.ts";
export { AzureBlobStoredObjectDriverAdapter } from "#repositories/azure/azure.stored-object-blob.repository";
export {
  ALLOW_INSECURE_TOKEN_ENDPOINT_ENV,
  AzureBackendMisconfiguredError,
  AzureBlobCredentialsAdapter,
  type AzureBlobCredentialsConfig,
  type AzureCredentials,
  type AzureInjectedIdentity,
  type AzureTokenAuthMode,
} from "./adapters/azure-blob-credentials.adapter.ts";
export {
  AzureBlobTokenProviderAdapter,
  AzureTokenExchangeError,
  type TokenModeCredentials,
} from "./adapters/azure-blob-token-provider.adapter.ts";
export {
  StoredObjectProjectDestinationResolverPort,
  StoredObjectStorageRuntimeAdapter,
  type StoredObjectStorageProject,
  type StoredObjectStorageRuntimeOptions,
} from "./adapters/stored-object-storage-runtime.adapter.ts";
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
  ObjectStorageMigrationInventoryPort,
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
  MigrationS3StorageDriverAdapter,
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
} from "./adapters/group-queue.object-storage-migration.adapter.ts";
export { PayloadStagingPort, type StagedPayload } from "./repositories/payload-staging.repository.ts";
export {
  PayloadStagingS3TargetPort,
  S3PayloadStagingAdapter,
  type PayloadStagingS3Target,
} from "#repositories/s3/s3.payload-staging.repository";
export {
  AbsentPayloadStagingAdapter,
  PayloadStagingUnavailableError,
} from "./adapters/absent.payload-staging.adapter.ts";
