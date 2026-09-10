/**
 * Whole-dataset re-derivations for a dataset stored as `contentLayout='s3_jsonl'` chunks:
 * recomputing the counters from storage truth, and rewriting every chunk when the column
 * schema changes. Both hold the per-dataset advisory lock for their whole run.
 */

import type { DatasetContentRepository } from "../repositories/dataset-content.repository.ts";
import { chunkedMeta, chunkMetaOf, toSingleJsonl } from "../rules/dataset-chunking.rules.ts";
import {
  MAX_INMEMORY_COLUMN_EDIT_BYTES,
  type DatasetMutationRecord,
  type RecomputedDatasetCounts,
  assertReady,
  isChunkLine,
  mapPreviousColumnsToNewColumns,
  recomputeOffsets,
  toChunkLines,
} from "../rules/dataset-chunk-lines.rules.ts";
import { type DatasetStorage } from "../app/dataset.app.ts";
import {
  DatasetConflictError,
  DatasetTooLargeToEditColumnsError,
  convertRowsToColumnTypes,
  type DatasetColumns,
  type DatasetRecordEntry,
} from "@langwatch/dataset-contract";

export class DatasetChunkMaintenanceService {
  static create(options: { datasets: DatasetContentRepository }): DatasetChunkMaintenanceService {
    return new DatasetChunkMaintenanceService(options.datasets);
  }

  private constructor(private readonly datasets: DatasetContentRepository) {}

  /**
   * I-COUNT repair: re-derive the counters from S3 truth, then write them back
   * under the lock. `chunkCount` is trusted as the boundary: a missing chunk
   * throws `MissingChunkError` rather than silently masking data loss.
   */
  async recomputeCounts({
    datasetId,
    projectId,
    storage,
  }: {
    datasetId: string;
    projectId: string;
    storage: DatasetStorage;
  }): Promise<RecomputedDatasetCounts> {
    const datasetStorage = storage;

    return this.datasets.withDatasetLock(datasetId, async (tx) => {
      const current = await tx.getOne({ id: datasetId, projectId });

      const chunkCount = current.chunkCount ?? 0;
      const perChunk: Array<{ rowCount: number; byteSize: number }> = [];
      for (let index = 0; index < chunkCount; index++) {
        // `readChunk` throws `MissingChunkError` if a chunk the count claims is
        // gone — corruption, not emptiness. Propagate it (loud) rather than mask it.
        const rows = await datasetStorage.readChunk({
          projectId,
          datasetId,
          index,
        });
        // Measure bytes from the actual chunk rows so the recomputed totals reflect
        // S3 truth, not a possibly-drifted offset entry.
        perChunk.push({
          rowCount: rows.length,
          byteSize: toSingleJsonl(rows).byteSize,
        });
      }

      const { offsets, rowCount, sizeBytes } = recomputeOffsets(perChunk);

      // Trim trailing empty chunks down to the highest non-empty index + 1, the
      // same LOGICAL compaction `deleteS3JsonlRecords` does, so repair stays
      // idempotent. Trailing objects are left as benign 0-byte orphans.
      let keptChunkCount = perChunk.length;
      while (keptChunkCount > 0 && perChunk[keptChunkCount - 1]!.rowCount === 0) {
        keptChunkCount -= 1;
      }

      const keptOffsets = offsets.slice(0, keptChunkCount);

      await tx.updateContent({
        id: datasetId,
        projectId,
        content: {
          rowCount,
          sizeBytes: BigInt(sizeBytes),
          chunkCount: keptChunkCount,
          chunkOffsets: keptOffsets,
        },
      });

      return {
        rowCount,
        sizeBytes,
        chunkCount: keptChunkCount,
        chunkOffsets: keptOffsets,
      };
    });
  }
  /**
   * Change an s3_jsonl dataset's column schema under the lock (ADR-032 v19):
   * remap keys, convert values, rewrite chunks from index 0, update counters.
   * Buffers all rows — a deliberate edit, not the streaming upload path.
   */
  async migrateColumns({
    dataset,
    projectId,
    oldColumnTypes,
    newColumnTypes,
    name,
    slug,
    storage,
  }: {
    dataset: DatasetMutationRecord;
    projectId: string;
    oldColumnTypes: DatasetColumns;
    newColumnTypes: DatasetColumns;
    name: string;
    slug: string;
    storage: DatasetStorage;
  }): Promise<DatasetMutationRecord> {
    const datasetStorage = storage;

    return this.datasets.withDatasetLock(dataset.id, async (tx) => {
      const current = await tx.getOne({ id: dataset.id, projectId });
      assertReady(current);
      assertColumnEditAllowed({ current, oldColumnTypes });

      const { ids, entries } = await this.readAllRows({
        dataset,
        projectId,
        chunkCount: current.chunkCount ?? 0,
        storage: datasetStorage,
      });

      // Remap keys old→new, then convert each value to its new declared type.
      const remapped = mapPreviousColumnsToNewColumns(entries, oldColumnTypes, newColumnTypes);
      const converted = convertRowsToColumnTypes(
        remapped as Record<string, unknown>[],
        newColumnTypes,
      );

      // Rewrite the chunks from index 0, preserving each row's id. Deliberately NOT
      // `writeInitialS3JsonlChunks`: that helper reaps chunks-from-0 on a write
      // FAILURE, which would delete existing content on this LIVE dataset. We
      // write directly and never delete on failure; orphan chunks past the new
      // count are reaped only AFTER a clean write.
      const lines = toChunkLines(converted, { forcedIds: ids });
      const written = await datasetStorage.writeChunks({
        projectId,
        datasetId: dataset.id,
        records: lines,
        fromIndex: 0,
      });
      const meta = chunkedMeta(written.map(chunkMetaOf));
      await datasetStorage.deleteChunksFrom({
        projectId,
        datasetId: dataset.id,
        fromIndex: meta.chunkCount,
      });

      return await tx.updateContent({
        id: dataset.id,
        projectId,
        content: {
          name,
          slug,
          columnTypes: newColumnTypes,
          rowCount: meta.rowCount,
          sizeBytes: BigInt(meta.sizeBytes),
          chunkCount: meta.chunkCount,
          chunkOffsets: meta.chunkOffsets,
        },
      });
    });
  }

  /** Every row of every chunk, in order, with the ids the rewrite must preserve. */
  private async readAllRows({
    dataset,
    projectId,
    chunkCount,
    storage,
  }: {
    dataset: DatasetMutationRecord;
    projectId: string;
    chunkCount: number;
    storage: DatasetStorage;
  }): Promise<{ ids: string[]; entries: DatasetRecordEntry[] }> {
    const ids: string[] = [];
    const entries: DatasetRecordEntry[] = [];
    for (let index = 0; index < chunkCount; index++) {
      const rows = await storage.readChunk({ projectId, datasetId: dataset.id, index });
      for (const line of rows) {
        if (isChunkLine(line)) {
          ids.push(line.id);
          entries.push(line.entry as DatasetRecordEntry);
        }
      }
    }

    return { ids, entries };
  }
}

/**
 * Two gates the column rewrite passes under the lock. The source schema is revalidated
 * because `oldColumnTypes` was captured before it: a concurrent edit that already rewrote the
 * chunks would make the remap read those rows with the stale schema and shift or drop values.
 * And the rewrite buffers every row while holding the lock, so above the byte cap it refuses
 * rather than risk exhausting the shared worker's heap. Both bail before any write.
 */
function assertColumnEditAllowed({
  current,
  oldColumnTypes,
}: {
  current: DatasetMutationRecord;
  oldColumnTypes: DatasetColumns;
}): void {
  if (JSON.stringify(current.columnTypes) !== JSON.stringify(oldColumnTypes)) {
    throw new DatasetConflictError(
      "Dataset columns changed since you opened the editor — please reopen and retry.",
      { reason: "stale_columns" },
    );
  }

  const currentSizeBytes = Number(current.sizeBytes ?? 0n);
  if (currentSizeBytes > MAX_INMEMORY_COLUMN_EDIT_BYTES) {
    throw new DatasetTooLargeToEditColumnsError({
      sizeBytes: currentSizeBytes,
      maxBytes: MAX_INMEMORY_COLUMN_EDIT_BYTES,
    });
  }
}
