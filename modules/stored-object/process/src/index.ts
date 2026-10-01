export { storedObjectProcessModule } from "./stored-object.module.ts";
export { AzureStoredObjectBlobRepository } from "#repositories/azure/azure.stored-object-blob.repository";
export { StoredObjectStorageRuntimeService } from "./services/stored-object-storage-runtime.service.ts";
export { AbsentPayloadStagingService } from "./services/absent-payload-staging.service.ts";

// Restored: these names have consumers outside this module.
export {
  StoredObjectDestinationPolicyService,
  StoredObjectAzureDestination,
  StoredObjectProjectS3Config,
  type StoredObjectStorageSelection,
} from "./services/stored-object-destination-policy.service.ts";
export type { StoredObjectBlobRepository } from "./repositories/stored-object-blob.repository.ts";
export {
  AzureBlobCredentialsService,
  type AzureBlobCredentialsConfig,
  type AzureInjectedIdentity,
} from "./services/azure-blob-credentials.service.ts";
export {
  StoredObjectProjectDestinationResolver,
  type StoredObjectStorageProject,
} from "./services/stored-object-storage-runtime.service.ts";
export {
  type StoredObjectsClickHouse,
  type StoredObjectsClickHouseClient,
} from "./app/stored-object.members.ts";
export type { StoredObject } from "./rules/stored-object-row.rules.ts";
export {
  auditQueuesForCutover,
  createMigrationTask,
  ObjectStorageMigrateTask,
  parseMigrationTaskConfig,
} from "./tasks/object-storage-migrate.task.ts";
export {
  ObjectStorageMigrationInventoryRepository,
  type MigrationDataset,
  type MigrationPageRequest,
  type MigrationProject,
} from "./repositories/object-storage-migration-inventory.repository.ts";
export { MigrationBlobS3Repository } from "#repositories/s3/s3.object-storage-migration-blob.repository";
export { PayloadStagingRepository } from "./repositories/payload-staging.repository.ts";
export {
  PayloadStagingS3TargetRepository,
  S3PayloadStagingRepository,
  type PayloadStagingS3Target,
} from "#repositories/s3/s3.payload-staging.repository";
