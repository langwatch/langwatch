/**
 * Deleting rows from a dataset stored as `contentLayout='s3_jsonl'` chunks. Two paths share
 * one counter commit: the fast path re-reads only the chunks an off-lock scan located, and
 * the full in-lock scan is the proven fallback whenever that hint no longer holds.
 */

import { createLogger } from "@langwatch/observability";
import { DatasetContentRepository } from "../repositories/dataset-content.repository.ts";
import { type ChunkOffset, toSingleJsonl } from "../rules/dataset-chunking.rules.ts";
import {
  type DatasetMutationRecord,
  assertReady,
  isChunkLine,
  readOffsets,
  recomputeOffsets,
} from "../rules/dataset-chunk-lines.rules.ts";
import { type DatasetStorage } from "../ports/dataset-storage.port.ts";

const logger = createLogger("langwatch:datasets:mutations");

/** The off-lock locate scan the owning service runs; a hint, never authoritative. */
type LocateIds = (input: {
  storage: DatasetStorage;
  projectId: string;
  datasetId: string;
  ids: Set<string>;
  chunkCount: number;
}) => Promise<{ affectedIndices: number[]; locatedIds: Set<string> } | null>;

type DatasetChunkDeleteServiceOptions = {
  datasets: DatasetContentRepository;
  locateIds: LocateIds;
};

export class DatasetChunkDeleteService {
  static create(deps: DatasetChunkDeleteServiceOptions): DatasetChunkDeleteService {
    return new DatasetChunkDeleteService(deps);
  }

  private constructor(private readonly deps: DatasetChunkDeleteServiceOptions) {}

  private get datasets(): DatasetContentRepository {
    return this.deps.datasets;
  }

  /**
   * Delete rows by id under the advisory lock: rewrite each affected chunk
   * without its removed rows. An emptied chunk is LEFT in place (no
   * compaction). scan-before-lock: bails to a full scan on any discrepancy.
   */
  async deleteRecords({
    dataset,
    projectId,
    recordIds,
    storage,
  }: {
    dataset: DatasetMutationRecord;
    projectId: string;
    recordIds: string[];
    storage: DatasetStorage;
  }): Promise<{ deleted: number }> {
    const datasetStorage = storage;
    const removeSet = new Set(recordIds);
    const isTarget = (line: unknown): boolean => isChunkLine(line) && removeSet.has(line.id);

    // OFF the lock: locate the target ids' chunks so only the affected chunks are
    // re-read under the lock (not all chunkCount). Skipped for a not-ready dataset
    // — never do storage I/O ahead of the readiness gate (the under-lock
    // `assertReady` stays authoritative).
    const hint =
      removeSet.size > 0 && dataset.status === "ready"
        ? await this.deps.locateIds({
            storage: datasetStorage,
            projectId,
            datasetId: dataset.id,
            ids: removeSet,
            chunkCount: dataset.chunkCount ?? 0,
          })
        : null;

    return this.datasets.withDatasetLock(dataset.id, async (tx) => {
      const current = await tx.findOneOrThrow({ id: dataset.id, projectId });
      assertReady(current);

      const chunkCount = current.chunkCount ?? 0;
      if (removeSet.size === 0) {
        return { deleted: 0 };
      }

      const offsets = readOffsets(current);

      // Fast path — only when the pre-scan located EVERY target id and the offset
      // index covers every chunk: re-read just the affected chunks, take unaffected
      // chunk sizes from the authoritative offset index. Bails (returns null) if
      // any located id isn't where the hint said.
      if (hint && hint.locatedIds.size === removeSet.size && offsets.length === chunkCount) {
        const fast = await this.deleteByHint({
          tx,
          dataset,
          projectId,
          storage: datasetStorage,
          removeSet,
          isTarget,
          hint,
          offsets,
          chunkCount,
        });
        if (fast) {
          return fast;
        }
      }

      return this.deleteByFullScan({
        tx,
        dataset,
        projectId,
        storage: datasetStorage,
        removeSet,
        chunkCount,
      });
    });
  }

  /**
   * Re-reads only the chunks the off-lock scan located, taking every unaffected chunk's size
   * from the authoritative offset index. Returns null when the hint no longer holds, so the
   * caller falls back to the proven full scan; no chunk is written before that check passes.
   */
  private async deleteByHint({
    tx,
    dataset,
    projectId,
    storage,
    removeSet,
    isTarget,
    hint,
    offsets,
    chunkCount,
  }: {
    tx: DatasetContentRepository;
    dataset: DatasetMutationRecord;
    projectId: string;
    storage: DatasetStorage;
    removeSet: Set<string>;
    isTarget: (line: unknown) => boolean;
    hint: { affectedIndices: number[]; locatedIds: Set<string> };
    offsets: ChunkOffset[];
    chunkCount: number;
  }): Promise<{ deleted: number } | null> {
    const planned = await this.planHintedDeletes({
      dataset,
      projectId,
      storage,
      removeSet,
      isTarget,
      hint,
      chunkCount,
    });
    if (!planned) {
      return null;
    }

    if (planned.deleted === 0) {
      return { deleted: 0 };
    }

    const newRowCount = new Map<number, number>();
    const newByteSize = new Map<number, number>();
    // Hint validated — now commit the buffered rewrites to S3.
    for (const { index, kept } of planned.pendingRewrites) {
      const offset = await storage.rewriteChunk({
        projectId,
        datasetId: dataset.id,
        index,
        records: kept,
      });
      newRowCount.set(index, kept.length);
      newByteSize.set(index, offset.byteSize);
    }

    // Per-chunk (rowCount, byteSize) for ALL chunks: affected from the
    // re-read above, the rest from the authoritative offset index (no read).
    const perChunk = [...offsets]
      .sort((a, b) => a.index - b.index)
      .map((o) => ({
        // Affected chunks from the re-read above; unaffected from the offset
        // index (rowCount = endRow - startRow, byteSize as stored).
        rowCount: newRowCount.get(o.index) ?? o.endRow - o.startRow,
        byteSize: newByteSize.get(o.index) ?? o.byteSize,
      }));
    await this.commitDeleteCounts({
      tx,
      datasetId: dataset.id,
      projectId,
      perChunk,
    });

    return { deleted: planned.deleted };
  }

  /**
   * Read every hinted chunk and buffer the rewrites, issuing no storage write at all: a
   * partial rewrite-then-bail would leave storage mutated while control falls through to the
   * full in-lock scan. Null means a located id was not where the hint said it was.
   */
  private async planHintedDeletes({
    dataset,
    projectId,
    storage,
    removeSet,
    isTarget,
    hint,
    chunkCount,
  }: {
    dataset: DatasetMutationRecord;
    projectId: string;
    storage: DatasetStorage;
    removeSet: Set<string>;
    isTarget: (line: unknown) => boolean;
    hint: { affectedIndices: number[]; locatedIds: Set<string> };
    chunkCount: number;
  }): Promise<{
    deleted: number;
    pendingRewrites: Array<{ index: number; kept: unknown[] }>;
  } | null> {
    const removedIds = new Set<string>();
    const pendingRewrites: Array<{ index: number; kept: unknown[] }> = [];
    let deleted = 0;
    for (const index of hint.affectedIndices) {
      if (index >= chunkCount) {
        continue;
      } // chunk trimmed away since the scan

      const rows = await storage.readChunk({
        projectId,
        datasetId: dataset.id,
        index,
      });
      const kept = rows.filter((line) => !isTarget(line));
      if (kept.length === rows.length) {
        continue;
      } // none of ours here now

      for (const line of rows) {
        if (isChunkLine(line) && removeSet.has(line.id)) {
          removedIds.add(line.id);
        }
      }

      deleted += rows.length - kept.length;
      pendingRewrites.push({ index, kept });
    }

    // Re-validate the hint: every located id must have been removed here. If
    // not, a concurrent mutation moved/removed it since the scan — bail to
    // the proven full scan rather than risk a missed delete. No S3 write has
    // happened yet, so the full scan starts from the unmodified chunks.
    for (const id of hint.locatedIds) {
      if (!removedIds.has(id)) {
        logger.warn(
          { projectId, datasetId: dataset.id, recordId: id },
          "delete fast-path drift: located id not removed (concurrent mutation); falling back to full in-lock scan",
        );

        return null;
      }
    }

    return { deleted, pendingRewrites };
  }

  /**
   * The proven path: read every chunk, drop the target rows, recompute. Used on a legacy or
   * offset-less dataset, and whenever the hint drifted. It measures unaffected chunks from
   * their actual bytes, so it also self-heals any pre-existing counter drift.
   */
  private async deleteByFullScan({
    tx,
    dataset,
    projectId,
    storage,
    removeSet,
    chunkCount,
  }: {
    tx: DatasetContentRepository;
    dataset: DatasetMutationRecord;
    projectId: string;
    storage: DatasetStorage;
    removeSet: Set<string>;
    chunkCount: number;
  }): Promise<{ deleted: number }> {
    // Full in-lock scan (the proven path): read every chunk, drop target rows,
    // recompute. Used on a legacy/no-offset dataset, or when the fast path
    // bailed on a hint discrepancy. Measures unaffected chunks from their actual
    // bytes, so this path also self-heals any pre-existing counter drift.
    const perChunk: Array<{ rowCount: number; byteSize: number }> = [];
    let deleted = 0;
    for (let index = 0; index < chunkCount; index++) {
      const rows = await storage.readChunk({
        projectId,
        datasetId: dataset.id,
        index,
      });
      const kept = rows.filter((line) => !(isChunkLine(line) && removeSet.has(line.id)));
      const removedHere = rows.length - kept.length;
      if (removedHere > 0) {
        deleted += removedHere;
        const offset = await storage.rewriteChunk({
          projectId,
          datasetId: dataset.id,
          index,
          records: kept,
        });
        perChunk.push({ rowCount: kept.length, byteSize: offset.byteSize });
      } else {
        perChunk.push({
          rowCount: rows.length,
          byteSize: toSingleJsonl(rows).byteSize,
        });
      }
    }

    if (deleted === 0) {
      return { deleted: 0 };
    }

    await this.commitDeleteCounts({
      tx,
      datasetId: dataset.id,
      projectId,
      perChunk,
    });

    return { deleted };
  }

  /**
   * I-COUNT repair: re-derive the counters from S3 truth, then write them back
   * under the lock. `chunkCount` is trusted as the boundary: a missing chunk
   * throws `MissingChunkError` rather than silently masking data loss.
   */
  /**
   * Write the recomputed counters for a delete: a full offset recompute plus
   * trailing-empty compaction. Shared by the fast and full-scan delete paths.
   */
  private async commitDeleteCounts({
    tx,
    datasetId,
    projectId,
    perChunk,
  }: {
    tx: DatasetContentRepository;
    datasetId: string;
    projectId: string;
    perChunk: Array<{ rowCount: number; byteSize: number }>;
  }): Promise<void> {
    const { offsets, rowCount, sizeBytes } = recomputeOffsets(perChunk);
    let keptChunkCount = perChunk.length;
    while (keptChunkCount > 0 && perChunk[keptChunkCount - 1]!.rowCount === 0) {
      keptChunkCount -= 1;
    }

    const trimmed = keptChunkCount < perChunk.length;
    await tx.updateContent({
      id: datasetId,
      projectId,
      content: {
        rowCount,
        sizeBytes: BigInt(sizeBytes),
        // The trailing empty offset entries (startRow === endRow, byteSize 0)
        // contribute nothing to the totals, so slicing is exact.
        ...(trimmed
          ? {
              chunkCount: keptChunkCount,
              chunkOffsets: offsets.slice(0, keptChunkCount),
            }
          : {
              chunkOffsets: offsets,
            }),
      },
    });
  }
}
