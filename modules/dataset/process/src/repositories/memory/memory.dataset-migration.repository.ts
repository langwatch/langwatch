import type {
  DatasetMigrationFingerprint,
  DatasetMigrationOutcome,
  DatasetMigrationRepository,
} from "../dataset-migration.repository.ts";

/** Memory datasets never had Postgres rows to move, so a run walks nothing. */
export class MemoryDatasetMigrationRepository implements DatasetMigrationRepository {
  private constructor() {}

  static create(): MemoryDatasetMigrationRepository {
    return new MemoryDatasetMigrationRepository();
  }

  async findProjectIds(): Promise<string[]> {
    return [];
  }

  async findPostgresDatasetIds(): Promise<string[]> {
    return [];
  }

  async isPostgresLayout(): Promise<boolean> {
    return false;
  }

  async getFingerprint(): Promise<DatasetMigrationFingerprint> {
    return { count: 0, maxUpdatedAt: null };
  }

  async findRecordPage(): Promise<{ id: string; entry: unknown }[]> {
    return [];
  }

  async commit(): Promise<DatasetMigrationOutcome> {
    return "already-migrated";
  }

  isSchemaPending(): boolean {
    return false;
  }
}
