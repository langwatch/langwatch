import type {
  DatasetMigrationFingerprint,
  DatasetMigrationMetadata,
  DatasetMigrationOutcome,
  DatasetMigrationRepository,
} from "../dataset-migration.repository.ts";
import type { DatasetRow } from "../dataset.repository.ts";
import type { MemoryDatasetDatabase } from "./memory.dataset.database.ts";

type DatasetKey = { datasetId: string; projectId: string };

/**
 * Memory datasets never had Postgres rows to move, so that walk finds nothing;
 * a row marked single-file (`useS3`) is copied like the live one.
 */
export class MemoryDatasetMigrationRepository implements DatasetMigrationRepository {
  private constructor(private readonly database: MemoryDatasetDatabase) {}

  static create(input: { database: MemoryDatasetDatabase }): MemoryDatasetMigrationRepository {
    return new MemoryDatasetMigrationRepository(input.database);
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

  async findSingleFileDatasetIds(input: {
    projectId: string;
    afterId?: string | undefined;
    limit: number;
  }): Promise<string[]> {
    return this.database
      .datasets()
      .filter((row) => row.projectId === input.projectId && isSingleFile(row))
      .map((row) => row.id)
      .filter((id) => input.afterId === undefined || id > input.afterId)
      .toSorted()
      .slice(0, input.limit);
  }

  async isSingleFileLayout(input: DatasetKey): Promise<boolean> {
    return this.database.datasets().some((row) => matches(row, input) && isSingleFile(row));
  }

  async commitSingleFile(
    input: DatasetKey & { metadata: DatasetMigrationMetadata },
  ): Promise<DatasetMigrationOutcome> {
    const row = this.database.datasets().find((stored) => matches(stored, input));
    if (!row || !isSingleFile(row)) return "already-migrated";
    this.database.putDataset({
      ...row,
      rowCount: input.metadata.rowCount,
      sizeBytes: BigInt(input.metadata.sizeBytes),
      chunkCount: input.metadata.chunkCount,
      chunkOffsets: input.metadata.chunkOffsets,
      contentLayout: "s3_jsonl",
    });
    return "migrated";
  }

  isSchemaPending(): boolean {
    return false;
  }
}

function isSingleFile(row: DatasetRow): boolean {
  return row.contentLayout === "postgres" && row.useS3;
}

function matches(row: DatasetRow, key: DatasetKey): boolean {
  return row.projectId === key.projectId && row.id === key.datasetId;
}
