import type { DatasetRecord } from "@langwatch/dataset-contract";
import { fromDate } from "@langwatch/time";

import type {
  DatasetMigrationFingerprint,
  DatasetMigrationMetadata,
  DatasetMigrationOutcome,
  DatasetMigrationRepository,
  DatasetMoveNotes,
} from "../dataset-migration.repository.ts";
import type { MemoryDatasetDatabase } from "./memory.dataset.database.ts";

type DatasetKey = { datasetId: string; projectId: string };

/** Ids compare by code unit, as the Postgres twin's `COLLATE "C"` does. */
function byCodeUnit(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

/**
 * The move's Postgres side over the memory twin's rows, by the same rules: a dataset is on the
 * records table when its layout is postgres without a single file, and rows are read by dataset
 * and project. One process holds this database, and `commit` checks and flips with no await
 * between, so the recheck the Postgres twin takes a lock for holds here as it is.
 */
export class MemoryDatasetMigrationRepository implements DatasetMigrationRepository {
  #database: MemoryDatasetDatabase;

  private constructor(database: MemoryDatasetDatabase) {
    this.#database = database;
  }

  static create(input: Readonly<{ database: MemoryDatasetDatabase }>) {
    return new MemoryDatasetMigrationRepository(input.database);
  }

  async findPostgresDatasetIds(input: {
    projectId: string;
    afterId?: string | undefined;
    limit: number;
  }): Promise<string[]> {
    return this.#database
      .datasets()
      .filter(
        (row) =>
          row.projectId === input.projectId && row.contentLayout === "postgres" && !row.useS3,
      )
      .map((row) => row.id)
      .filter((id) => input.afterId === undefined || id > input.afterId)
      .toSorted(byCodeUnit)
      .slice(0, input.limit);
  }

  async isPostgresLayout(input: DatasetKey): Promise<boolean> {
    const row = this.#row(input);
    return row?.contentLayout === "postgres" && !row.useS3;
  }

  async findMoveNotes(input: DatasetKey): Promise<DatasetMoveNotes> {
    return {
      archived: this.#row(input)?.archivedAt != null,
      rowsUnderOtherProject: this.#database
        .records()
        .filter((record) => record.datasetId === input.datasetId)
        .filter((record) => record.projectId !== input.projectId).length,
    };
  }

  async getFingerprint(input: DatasetKey): Promise<DatasetMigrationFingerprint> {
    return this.#fingerprint(input);
  }

  async findRecordPage(
    input: DatasetKey & { afterId?: string | undefined; limit: number },
  ): Promise<{ id: string; entry: unknown }[]> {
    const records = this.#records(input);
    const start = input.afterId
      ? records.findIndex((record) => record.id === input.afterId) + 1
      : 0;
    // A cursor naming no row of this dataset answers an empty page, as Postgres does.
    if (input.afterId && start === 0) return [];
    return records
      .slice(start, start + input.limit)
      .map((record) => ({ id: record.id, entry: structuredClone(record.entry) }));
  }

  async commit(
    input: DatasetKey & {
      baseline: DatasetMigrationFingerprint;
      metadata: DatasetMigrationMetadata;
    },
  ): Promise<DatasetMigrationOutcome> {
    const row = this.#row(input);
    if (row?.contentLayout !== "postgres" || row.useS3) return "already-migrated";
    const recheck = this.#fingerprint(input);
    if (
      recheck.count !== input.baseline.count ||
      recheck.maxUpdatedAt?.epochMilliseconds !== input.baseline.maxUpdatedAt?.epochMilliseconds
    ) {
      return "skipped-concurrent-write";
    }
    this.#database.putDataset({
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

  #row(input: DatasetKey) {
    return this.#database
      .datasets()
      .find((row) => row.id === input.datasetId && row.projectId === input.projectId);
  }

  /** `[createdAt asc, id asc]`, the order the Postgres twin pages in. */
  #records(input: DatasetKey): DatasetRecord[] {
    return this.#database
      .records()
      .filter((record) => record.datasetId === input.datasetId)
      .filter((record) => record.projectId === input.projectId)
      .toSorted(
        (left, right) =>
          left.createdAt.getTime() - right.createdAt.getTime() || byCodeUnit(left.id, right.id),
      );
  }

  #fingerprint(input: DatasetKey): DatasetMigrationFingerprint {
    const records = this.#records(input);
    const newest = records.reduce<Date | null>(
      (latest, record) => (latest && latest >= record.updatedAt ? latest : record.updatedAt),
      null,
    );
    return { count: records.length, maxUpdatedAt: newest ? fromDate(newest) : null };
  }
}
