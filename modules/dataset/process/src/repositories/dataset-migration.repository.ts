export type DatasetMigrationOutcome =
  | "migrated"
  | "already-migrated"
  | "would-migrate"
  | "skipped-concurrent-write";

export type DatasetMigrationSummary = {
  migrated: number;
  wouldMigrate: number;
  alreadyMigrated: number;
  skippedConcurrentWrite: number;
  failed: number;
};

export type DatasetMigrationRunResult =
  | { status: "completed"; summary: DatasetMigrationSummary }
  | { status: "schema-pending" };

/** The one-off move of dataset content from Postgres rows into object-storage chunks. */
export interface DatasetMigrationRepository {
  run(input?: { dryRun?: boolean }): Promise<DatasetMigrationRunResult>;
}
