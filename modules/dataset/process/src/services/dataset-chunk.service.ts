/**
 * ADR-032 rung 6b — the write side of `contentLayout='s3_jsonl'`. Every
 * operation mutates S3 chunks AND Postgres counters under the per-dataset
 * advisory lock (Decision 9 / I-COUNT); this class keeps append, edit and locate.
 */

import {
  type DatasetColumnRenames,
  type DatasetColumns,
  DuplicateRecordIdError,
} from "@langwatch/dataset-contract";
import { createLogger } from "@langwatch/observability";

import type { DatasetChunkRepository } from "../repositories/dataset-chunk.repository.ts";
import type { DatasetContentRepository } from "../repositories/dataset-content.repository.ts";
import {
  type DatasetMutationRecord,
  type RecomputedDatasetCounts,
  assertReady,
  isChunkLine,
  readOffsets,
  toChunkLines,
} from "../rules/dataset-chunk-lines.rules.ts";
import {
  type ChunkedDatasetMeta,
  type ChunkOffset,
  chunkedMeta,
  chunkMetaOf,
} from "../rules/dataset-chunking.rules.ts";
import { assertColumnsCurrent } from "../rules/dataset-columns.rules.ts";
import { DatasetChunkDeleteService } from "./dataset-chunk-delete.service.ts";
import { DatasetChunkMaintenanceService } from "./dataset-chunk-maintenance.service.ts";
import { DatasetChunkRowEditService } from "./dataset-chunk-row-edit.service.ts";

const logger = createLogger("langwatch:datasets:mutations");

/**
 * Every write to a dataset stored as s3_jsonl chunks. `repository` is
 * process-scoped (a field); `storage` is resolved per project (an argument).
 * The lock and its transaction belong to the repository.
 */
export class DatasetChunkService {
  private readonly deletes: DatasetChunkDeleteService;

  private readonly maintenance: DatasetChunkMaintenanceService;

  private readonly rowEdits = DatasetChunkRowEditService.create();

  private constructor(private readonly datasets: DatasetContentRepository) {
    this.deletes = DatasetChunkDeleteService.create({
      datasets,
      locateIds: (input) => this.locateIds(input),
    });
    this.maintenance = DatasetChunkMaintenanceService.create({ datasets });
  }

  static create(options: { datasets: DatasetContentRepository }): DatasetChunkService {
    return new DatasetChunkService(options.datasets);
  }

  /**
   * Born-on-storage (ADR-032 cutover step 1): write a new dataset's records to
   * chunk objects from index 0. No lock — the row doesn't exist yet;
   * self-cleaning on a partial write.
   */
  async writeInitialChunks({
    projectId,
    datasetId,
    entries,
    forcedIds,
    storage,
  }: {
    projectId: string;
    datasetId: string;
    entries: unknown[];
    forcedIds?: (string | undefined)[];
    storage: DatasetChunkRepository;
  }): Promise<ChunkedDatasetMeta> {
    const datasetStorage = storage;

    const lines = toChunkLines(entries, { forcedIds });
    let written: Awaited<ReturnType<DatasetChunkRepository["writeChunks"]>>;
    try {
      written = await datasetStorage.writeChunks({
        projectId,
        datasetId,
        records: lines,
        fromIndex: 0,
      });
    } catch (error) {
      // A partial write leaves a contiguous `0..k` orphan prefix; reap it.
      // Best-effort: a failed reap must not mask the original write error.
      try {
        await datasetStorage.deleteChunksFrom({
          projectId,
          datasetId,
          fromIndex: 0,
        });
      } catch (cleanupError) {
        if (!(cleanupError instanceof Error)) {
          throw cleanupError;
        }
        // swallow — surface the write failure below
      }

      throw error;
    }

    return chunkedMeta(written.map(chunkMetaOf));
  }

  /**
   * Best-effort delete of ALL chunk objects of a dataset (from index 0). Reaps
   * orphans `writeInitialS3JsonlChunks` left when the row insert after it fails.
   * No lock, no counters — there is no row to serialize against.
   */
  async deleteAllChunks({
    projectId,
    datasetId,
    storage,
  }: {
    projectId: string;
    datasetId: string;
    storage: DatasetChunkRepository;
  }): Promise<void> {
    const datasetStorage = storage;
    await datasetStorage.deleteChunksFrom({ projectId, datasetId, fromIndex: 0 });
  }

  /**
   * Append rows to an s3_jsonl dataset under the advisory lock, wrapped
   * `{ id, entry }`. Re-reads the dataset inside the lock since another
   * mutation may have advanced the counters. `forcedIds` honors caller ids.
   */
  async append({
    dataset,
    projectId,
    entries,
    forcedIds,
    storage,
    columns,
    newIds,
  }: {
    dataset: DatasetMutationRecord;
    projectId: string;
    entries: unknown[];
    forcedIds?: (string | undefined)[];
    storage: DatasetChunkRepository;
    /** The columns the caller checked the entries against; refused when one is gone. */
    columns?: readonly string[] | undefined;
    /** Ids the chunks must not hold yet, as the records table refuses a taken id. */
    newIds?: readonly string[] | undefined;
  }): Promise<{ appended: number }> {
    const datasetStorage = storage;

    return this.datasets.withDatasetLock(dataset.id, async (tx) => {
      const current = await tx.getOne({ id: dataset.id, projectId });
      assertReady(current);
      assertColumnsCurrent({ columns, columnTypes: current.columnTypes });
      if (newIds && newIds.length > 0) {
        const wanted = new Set(newIds);
        for (let index = 0; index < (current.chunkCount ?? 0); index++) {
          const rows = await datasetStorage.readChunk({ projectId, datasetId: dataset.id, index });
          const taken = rows.find((line) => isChunkLine(line) && wanted.has(line.id));
          if (isChunkLine(taken)) throw new DuplicateRecordIdError(taken.id);
        }
      }

      return this.appendLines({
        tx,
        current,
        projectId,
        entries,
        forcedIds,
        storage: datasetStorage,
      });
    });
  }

  /**
   * Locate a row by id and replace its `entry` in place, rewriting only that
   * chunk. Not found → appended as new (upsert-of-new). scan-before-lock: the
   * locate runs OFF the lock, falling to a full in-lock scan if it drifted.
   */
  async editRecord({
    dataset,
    projectId,
    recordId,
    entry,
    storage,
    columns,
  }: {
    dataset: DatasetMutationRecord;
    projectId: string;
    recordId: string;
    entry: unknown;
    storage: DatasetChunkRepository;
    /** The columns the caller keyed the entry by; refused when one is gone. */
    columns?: readonly string[] | undefined;
  }): Promise<{ updated: boolean }> {
    const datasetStorage = storage;

    // OFF the lock: locate the row's chunk so only that chunk is re-read under it.
    // Skipped unless the dataset looks ready — never do storage I/O ahead of the
    // readiness gate (the under-lock `assertReady` stays authoritative).
    const hint =
      dataset.status === "ready"
        ? await this.locateIds({
            storage: datasetStorage,
            projectId,
            datasetId: dataset.id,
            ids: new Set([recordId]),
            chunkCount: dataset.chunkCount ?? 0,
          })
        : null;

    return this.datasets.withDatasetLock(dataset.id, async (tx) => {
      const current = await tx.getOne({ id: dataset.id, projectId });
      assertReady(current);
      assertColumnsCurrent({ columns, columnTypes: current.columnTypes });

      const target = { tx, current, dataset, projectId, recordId, entry, storage: datasetStorage };
      if ((await this.rowEdits.editInPlace({ ...target, hint })) === "edited") {
        return { updated: true };
      }

      // Not an existing row → append it, pinning the requested id (matches the PG
      // upsertRecord / updateDatasetRecord create-on-miss path).
      await this.appendLines({
        tx,
        current,
        projectId,
        entries: [entry],
        storage: datasetStorage,
        forcedIds: [recordId],
      });

      return { updated: false };
    });
  }

  /**
   * Delete rows by id under the advisory lock: rewrite each affected chunk
   * without its removed rows. An emptied chunk is LEFT in place (no
   * compaction). scan-before-lock: bails to a full scan on any discrepancy.
   */
  deleteRecords(input: {
    dataset: DatasetMutationRecord;
    projectId: string;
    recordIds: string[];
    storage: DatasetChunkRepository;
  }): Promise<{ deleted: number }> {
    return this.deletes.deleteRecords(input);
  }

  /**
   * I-COUNT repair: re-derive the counters from S3 truth, then write them back
   * under the lock. `chunkCount` is trusted as the boundary: a missing chunk
   * throws `MissingChunkError` rather than silently masking data loss.
   */
  recomputeCounts(input: {
    datasetId: string;
    projectId: string;
    storage: DatasetChunkRepository;
  }): Promise<RecomputedDatasetCounts> {
    return this.maintenance.recomputeCounts(input);
  }

  /**
   * Change an s3_jsonl dataset's column schema under the lock (ADR-032 v19):
   * remap keys, convert values, rewrite chunks from index 0, update counters.
   * Buffers all rows — a deliberate edit, not the streaming upload path.
   */
  migrateColumns(input: {
    dataset: DatasetMutationRecord;
    projectId: string;
    oldColumnTypes: DatasetColumns;
    newColumnTypes: DatasetColumns;
    columnRenames?: DatasetColumnRenames;
    name: string;
    slug: string;
    storage: DatasetChunkRepository;
  }): Promise<DatasetMutationRecord> {
    return this.maintenance.migrateColumns(input);
  }

  /**
   * Append lines within an already-locked transaction: write new chunk(s) from the
   * current `chunkCount` and extend the counters. Shared by the public append and
   * edit's create-on-miss branch so the lock + counter math lives once.
   */
  private async appendLines({
    tx,
    current,
    projectId,
    entries,
    storage,
    forcedIds,
  }: {
    tx: DatasetContentRepository;
    current: DatasetMutationRecord;
    projectId: string;
    entries: unknown[];
    storage: DatasetChunkRepository;
    forcedIds?: (string | undefined)[];
  }): Promise<{ appended: number }> {
    const lines = toChunkLines(entries, { forcedIds });

    const fromIndex = current.chunkCount ?? 0;
    const oldRowCount = current.rowCount ?? 0;
    const written = await storage.writeChunks({
      projectId,
      datasetId: current.id,
      records: lines,
      fromIndex,
    });

    const newOffsets: ChunkOffset[] = written.map((c) => ({
      index: c.index,
      startRow: c.startRow + oldRowCount,
      endRow: c.endRow + oldRowCount,
      byteSize: c.byteSize,
    }));
    const addedRows = written.reduce((n, c) => n + c.rowCount, 0);
    const addedBytes = written.reduce((n, c) => n + c.byteSize, 0);

    await tx.updateContent({
      id: current.id,
      projectId,
      content: {
        rowCount: oldRowCount + addedRows,
        sizeBytes: (current.sizeBytes ?? 0n) + BigInt(addedBytes),
        chunkCount: fromIndex + written.length,
        chunkOffsets: readOffsets(current).concat(newOffsets),
      },
    });

    return { appended: lines.length };
  }

  /**
   * Pre-lock locate scan (no lock held): finds which chunk holds each of `ids`.
   * A HINT, never authoritative — the caller re-validates under the lock and
   * bails to a full scan on any discrepancy.
   */
  private async locateIds({
    storage,
    projectId,
    datasetId,
    ids,
    chunkCount,
  }: {
    storage: DatasetChunkRepository;
    projectId: string;
    datasetId: string;
    ids: Set<string>;
    chunkCount: number;
  }): Promise<{ affectedIndices: number[]; locatedIds: Set<string> } | null> {
    const affected = new Set<number>();
    const locatedIds = new Set<string>();
    const remaining = new Set(ids);
    for (let index = 0; index < chunkCount && remaining.size > 0; index++) {
      let rows: unknown[];
      try {
        rows = await storage.readChunk({ projectId, datasetId, index });
      } catch {
        // Couldn't read this chunk off the lock (e.g. racing a rewrite). Abandon
        // the hint so the caller uses the proven full in-lock scan instead of
        // acting on a partial locate.
        logger.warn(
          { projectId, datasetId, index },
          "off-lock chunk read failed during id locate; abandoning fast-path hint, falling back to full in-lock scan",
        );

        return null;
      }

      for (const line of rows) {
        if (isChunkLine(line) && remaining.has(line.id)) {
          affected.add(index);
          locatedIds.add(line.id);
          remaining.delete(line.id);
        }
      }
    }

    return { affectedIndices: [...affected].toSorted((a, b) => a - b), locatedIds };
  }
}
