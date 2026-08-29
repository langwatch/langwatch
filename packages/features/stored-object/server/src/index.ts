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
} from "./api/app-rest/stored-object.api";
export { StoredObjectsInternalApi } from "./api/internal/stored-object.api";
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
} from "./api/app-trpc/stored-object.api";
