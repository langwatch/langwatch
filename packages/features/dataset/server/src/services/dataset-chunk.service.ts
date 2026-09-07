/**
 * ADR-032 rung 6b — the write side of a dataset stored as `contentLayout='s3_jsonl'`.
 * Every operation mutates S3 chunks AND Postgres counters under the per-dataset
 * advisory lock (Decision 9 / I-COUNT). Deleting and whole-dataset re-derivation are
 * their own collaborators; this class keeps the append and edit paths and the locate scan.
 */

import { createLogger } from "@langwatch/observability";
import { DatasetContentRepository } from "../repositories/dataset-content.repository.ts";
import {
  type ChunkedDatasetMeta,
  type ChunkOffset,
  chunkedMeta,
  chunkMetaOf,
} from "../rules/dataset-chunking.rules.ts";
import {
  type ChunkLine,
  type DatasetMutationRecord,
  type RecomputedDatasetCounts,
  assertReady,
  isChunkLine,
  readOffsets,
  toChunkLines,
} from "../rules/dataset-chunk-lines.rules.ts";
import { type DatasetStorage } from "../ports/dataset-storage.port.ts";
import { type DatasetColumns } from "@langwatch/dataset-contract";
import { DatasetChunkDeleteService } from "./dataset-chunk-delete.service.ts";
import { DatasetChunkMaintenanceService } from "./dataset-chunk-maintenance.service.ts";

const logger = createLogger("langwatch:datasets:mutations");

/** What the off-lock locate scan reported, or null when it was skipped or abandoned. */
type LocateHint = { affectedIndices: number[]; locatedIds: Set<string> } | null;

/** The one row an edit targets, together with the lock's transaction and re-read row. */
type EditTarget = {
  tx: DatasetContentRepository;
  current: DatasetMutationRecord;
  dataset: DatasetMutationRecord;
  projectId: string;
  recordId: string;
  entry: unknown;
  storage: DatasetStorage;
};

/**
 * Every write to a dataset stored as s3_jsonl chunks. `repository` is
 * process-scoped (a field); `storage` is resolved per project (an argument).
 * The lock and its transaction belong to the repository.
 */
export class DatasetChunkService {
  private readonly deletes: DatasetChunkDeleteService;

  private readonly maintenance: DatasetChunkMaintenanceService;

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
    storage: DatasetStorage;
  }): Promise<ChunkedDatasetMeta> {
    const datasetStorage = storage;

    const lines = toChunkLines(entries, { forcedIds });
    let written: Awaited<ReturnType<DatasetStorage["writeChunks"]>>;
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
      } catch {
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
    storage: DatasetStorage;
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
  }: {
    dataset: DatasetMutationRecord;
    projectId: string;
    entries: unknown[];
    forcedIds?: (string | undefined)[];
    storage: DatasetStorage;
  }): Promise<{ appended: number }> {
    const datasetStorage = storage;

    return this.datasets.withDatasetLock(dataset.id, async (tx) => {
      const current = await tx.findOneOrThrow({ id: dataset.id, projectId });
      assertReady(current);

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
  }: {
    dataset: DatasetMutationRecord;
    projectId: string;
    recordId: string;
    entry: unknown;
    storage: DatasetStorage;
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
      const current = await tx.findOneOrThrow({ id: dataset.id, projectId });
      assertReady(current);

      const target = { tx, current, dataset, projectId, recordId, entry, storage: datasetStorage };
      const hinted = await this.editHintedChunk({ ...target, hint });
      if (hinted) {
        return hinted;
      }

      const scanned = await this.editByFullScan(target);
      if (scanned) {
        return scanned;
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
   * Replace the row's entry at (index, rowIndex) in place and patch only that chunk's
   * byteSize — rows don't move on edit, so startRow/endRow are unchanged. Shared by the
   * hinted and full-scan branches.
   */
  private async rewriteRowAt({
    tx,
    current,
    dataset,
    projectId,
    recordId,
    entry,
    storage,
    index,
    rows,
    rowIndex,
  }: EditTarget & { index: number; rows: unknown[]; rowIndex: number }): Promise<void> {
    const offsets = readOffsets(current);
    const updatedRows = rows.slice();
    updatedRows[rowIndex] = { id: recordId, entry } satisfies ChunkLine;
    const offset = await storage.rewriteChunk({
      projectId,
      datasetId: dataset.id,
      index,
      records: updatedRows,
    });
    const oldByteSize = offsets[index]?.byteSize ?? 0;
    const patched = offsets.map((o) =>
      o.index === index ? { ...o, byteSize: offset.byteSize } : o,
    );
    await tx.updateContent({
      id: dataset.id,
      projectId,
      content: {
        sizeBytes: (current.sizeBytes ?? 0n) + BigInt(offset.byteSize - oldByteSize),
        chunkOffsets: patched,
      },
    });
  }

  /**
   * Fast path — the pre-scan located the row and the offset index covers every chunk, so
   * only that one chunk is re-read under the lock. Null means the hint did not hold and the
   * caller falls through to the full scan.
   */
  private async editHintedChunk(
    target: EditTarget & { hint: LocateHint },
  ): Promise<{ updated: true } | null> {
    const { current, dataset, projectId, recordId, storage, hint } = target;
    const chunkCount = current.chunkCount ?? 0;
    const offsets = readOffsets(current);
    if (!hint?.locatedIds.has(recordId) || offsets.length !== chunkCount) {
      return null;
    }

    const index = hint.affectedIndices[0]!;
    if (index >= chunkCount) {
      return null;
    }

    const rows = await storage.readChunk({ projectId, datasetId: dataset.id, index });
    const rowIndex = rows.findIndex((line) => isChunkLine(line) && line.id === recordId);
    if (rowIndex === -1) {
      // Row moved/removed since the scan → fall through to the full scan.
      logger.warn(
        { projectId, datasetId: dataset.id, recordId, index },
        "edit fast-path drift: located row not in hinted chunk; falling back to full in-lock scan",
      );

      return null;
    }

    await this.rewriteRowAt({ ...target, index, rows, rowIndex });

    return { updated: true };
  }

  /**
   * The proven path: read chunks in order until the id is found and rewrite it in place.
   * Null means the id exists in no chunk, so the caller appends it as a new row.
   */
  private async editByFullScan(target: EditTarget): Promise<{ updated: true } | null> {
    const { current, dataset, projectId, recordId, storage } = target;
    const chunkCount = current.chunkCount ?? 0;
    for (let index = 0; index < chunkCount; index++) {
      const rows = await storage.readChunk({ projectId, datasetId: dataset.id, index });
      const rowIndex = rows.findIndex((line) => isChunkLine(line) && line.id === recordId);
      if (rowIndex === -1) {
        continue;
      }

      await this.rewriteRowAt({ ...target, index, rows, rowIndex });

      return { updated: true };
    }

    return null;
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
    storage: DatasetStorage;
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
    storage: DatasetStorage;
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
    name: string;
    slug: string;
    storage: DatasetStorage;
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
    storage: DatasetStorage;
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
    storage: DatasetStorage;
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
        if (!isChunkLine(line)) continue;
        if (!remaining.has(line.id)) continue;
        affected.add(index);
        locatedIds.add(line.id);
        remaining.delete(line.id);
      }
    }

    return { affectedIndices: [...affected].sort((a, b) => a - b), locatedIds };
  }
}
