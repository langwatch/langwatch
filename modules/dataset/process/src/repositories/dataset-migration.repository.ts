import type { Instant } from "@langwatch/time";

import type { SkippedSingleFile } from "../rules/dataset-single-file.rules.ts";

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
  /** Single-file datasets (`useS3`) copied into chunks, or that a dry run would copy. */
  singleFileConverted: number;
  singleFileWouldConvert: number;
  /** Single-file datasets left in place: the file is missing or not a record array. */
  singleFileSkipped: SkippedSingleFile[];
};

/** `incomplete`: some dataset failed or changed mid-move; the checkpoint never passed it. */
export type DatasetMigrationRunResult =
  | { status: "completed"; summary: DatasetMigrationSummary }
  | { status: "incomplete"; summary: DatasetMigrationSummary }
  | { status: "schema-pending" };

/** How many records a dataset holds and when the newest changed: the concurrent-write check. */
export type DatasetMigrationFingerprint = {
  count: number;
  maxUpdatedAt: Instant | null;
};

/** The chunk layout a migrated dataset's row is committed with. */
export type DatasetMigrationMetadata = {
  rowCount: number;
  sizeBytes: number;
  chunkCount: number;
  chunkOffsets: { index: number; startRow: number; endRow: number; byteSize: number }[];
};

type DatasetKey = { datasetId: string; projectId: string };

/** The Postgres side of the one-off move of dataset content into object-storage chunks. */
export interface DatasetMigrationRepository {
  /** One id-ordered page of a project's datasets still on the postgres layout. */
  findPostgresDatasetIds(input: {
    projectId: string;
    afterId?: string | undefined;
    limit: number;
  }): Promise<string[]>;
  isPostgresLayout(input: DatasetKey): Promise<boolean>;
  getFingerprint(input: DatasetKey): Promise<DatasetMigrationFingerprint>;
  /** One page of a dataset's records in canonical order. */
  findRecordPage(
    input: DatasetKey & { afterId?: string | undefined; limit: number },
  ): Promise<{ id: string; entry: unknown }[]>;
  /** Flips the dataset onto its chunks under a lock, unless records changed since `baseline`. */
  commit(
    input: DatasetKey & {
      baseline: DatasetMigrationFingerprint;
      metadata: DatasetMigrationMetadata;
    },
  ): Promise<DatasetMigrationOutcome>;
  /** One id-ordered page of a project's single-file datasets (`useS3`) not yet in chunks. */
  findSingleFileDatasetIds(input: {
    projectId: string;
    afterId?: string | undefined;
    limit: number;
  }): Promise<string[]>;
  isSingleFileLayout(input: DatasetKey): Promise<boolean>;
  /** Flips a single-file dataset onto its chunks under a lock, unless it was flipped meanwhile. */
  commitSingleFile(
    input: DatasetKey & { metadata: DatasetMigrationMetadata },
  ): Promise<DatasetMigrationOutcome>;
  /** Whether a failure means the schema this migration needs is not applied yet. */
  isSchemaPending(error: unknown): boolean;
}
