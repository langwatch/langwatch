export { storedObjectProcessModule } from "./stored-object.module.ts";

// Restored: these names have consumers outside this module.
export type { StoredObjectStorageSelection } from "./services/stored-object-destination-policy.service.ts";
export type { StoredObjectBlobRepository } from "./repositories/stored-object-blob.repository.ts";
export type {
  AzureBlobCredentialsConfig,
  AzureInjectedIdentity,
} from "./services/azure-blob-credentials.service.ts";
export type { StoredObjectStorageProject } from "./services/stored-object-storage-runtime.service.ts";
export type {
  StoredObjectsClickHouse,
  StoredObjectsClickHouseClient,
} from "./repositories/clickhouse/stored-objects.repository.ts";
export type { StoredObject } from "./rules/stored-object-row.rules.ts";
export {
  auditQueuesForCutover,
  createMigrationTask,
  ObjectStorageMigrateTask,
  parseMigrationTaskConfig,
} from "./tasks/object-storage-migrate.task.ts";
export type {
  MigrationDataset,
  MigrationPageRequest,
  MigrationProject,
} from "./repositories/object-storage-migration-inventory.repository.ts";
export type { PayloadStagingS3Target } from "#repositories/s3/s3.payload-staging.repository";
