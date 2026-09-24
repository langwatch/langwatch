import type {
  DatasetMigrationRepository,
  DatasetMigrationRunResult,
} from "../dataset-migration.repository.ts";

/** Memory datasets never had Postgres rows to move, so every run completes with nothing moved. */
export class MemoryDatasetMigrationRepository implements DatasetMigrationRepository {
  private constructor() {}

  static create(): MemoryDatasetMigrationRepository {
    return new MemoryDatasetMigrationRepository();
  }

  run(_input?: { dryRun?: boolean }): Promise<DatasetMigrationRunResult> {
    return Promise.resolve({
      status: "completed",
      summary: {
        migrated: 0,
        wouldMigrate: 0,
        alreadyMigrated: 0,
        skippedConcurrentWrite: 0,
        failed: 0,
      },
    });
  }
}
