/**
 * ADR-032 rung 6b — the write side of a dataset stored as `contentLayout='s3_jsonl'`.
 * Every operation mutates S3 chunks AND Postgres counters under the per-dataset
 * advisory lock (Decision 9 / I-COUNT). Single home for this logic.
 */

import { createLogger } from "@langwatch/observability";
import { nanoid } from "nanoid";
import { DatasetContentRepository } from "../repositories/dataset-content.repository";
import {
  type ChunkedDatasetMeta,
  type ChunkOffset,
  chunkedMeta,
  chunkMetaOf,
  toSingleJsonl,
} from "./dataset-chunking.service";
import { type DatasetStorage } from "../ports/dataset-storage.port";
import {
  DatasetConflictError,
  DatasetNotReadyError,
  DatasetTooLargeToEditColumnsError,
  DuplicateRecordIdError,
} from "./dataset-errors.service";
import { stripNullBytes } from "../rules/dataset-sanitize.rules";
import {
  convertRowsToColumnTypes,
  type DatasetColumns,
  type DatasetRecordEntry,
  type DatasetRecordInput,
} from "@langwatch/dataset-contract";

const logger = createLogger("langwatch:datasets:mutations");

const tryToMapPreviousColumnsToNewColumns = (
  records: DatasetRecordInput[],
  previousColumns: DatasetColumns,
  newColumns: DatasetColumns,
): DatasetRecordInput[] => {
  const mapping: Record<string, string | undefined> = {};
  for (const previous of previousColumns) {
    const exact = newColumns.find((column) => column.name === previous.name);
    if (exact) {
      mapping[previous.name] = exact.name;
    }
  }

  const previousUnmapped = previousColumns.filter((column) => !(column.name in mapping));
  const newUnmapped = newColumns.filter((column) => !Object.values(mapping).includes(column.name));
  previousUnmapped.forEach((previous, index) => {
    const next = newUnmapped[index];
    if (next) {
      mapping[previous.name] = next.name;
    }
  });

  return records.map((record) => {
    const mapped: DatasetRecordInput = record.id ? { id: record.id } : {};
    for (const [key, value] of Object.entries(record)) {
      if (key !== "id" && mapping[key]) {
        mapped[mapping[key]!] = value;
      }
    }

    return mapped;
  });
};

/**
 * Storage mutation state shared by the portable Dataset aggregate and the
 * private Prisma row. Mutation code needs these fields, not a generated model.
 */
export type DatasetMutationRecord = {
  id: string;
  status: string;
  statusError: string | null;
  chunkCount: number | null;
  chunkOffsets: unknown;
  rowCount: number | null;
  sizeBytes: bigint | null;
  columnTypes: unknown;
};

/**
 * Byte ceiling for the in-memory column-type rewrite (ADR-032 v19): above this
 * we refuse rather than buffer the whole dataset in heap under the advisory lock.
 * Set above the largest expected hand-edited dataset.
 */
export const MAX_INMEMORY_COLUMN_EDIT_BYTES = 512 * 1024 * 1024;

export type RecomputedDatasetCounts = {
  rowCount: number;
  sizeBytes: number;
  chunkCount: number;
  chunkOffsets: ChunkOffset[];
};

/** An s3_jsonl chunk line: the row entry tagged with a stable id so edit/delete
 * can target it. Mirrors the shape the normalize/append paths write. */
type ChunkLine = { id: string; entry: unknown };

/**
 * Wrap raw row entries as `{ id, entry }` chunk lines: mint a stable per-row id
 * (`record_<nanoid>`), and scrub U+0000 from the entry (I-NULL). `forcedIds`
 * pins each new row's id. Shared by the append and born-on-storage paths.
 */
const toChunkLines = (
  entries: unknown[],
  { forcedIds }: { forcedIds?: (string | undefined)[] } = {},
): ChunkLine[] => {
  const lines = entries.map((entry, i) => ({
    id: forcedIds?.[i] ?? `record_${nanoid()}`,
    entry: stripNullBytes(entry),
  }));
  // I-PG: row ids are unique within a dataset (the legacy PG PK). Minted ids can't
  // collide, but caller-supplied `forcedIds` can — reject the duplicate at the
  // id-assignment chokepoint rather than silently creating a ghost row.
  // Within-batch only: a cross-batch collision needs an O(rowCount) scan the edit
  // create-on-miss path already guards.
  const seen = new Set<string>();
  for (const { id } of lines) {
    if (seen.has(id)) {
      throw new DuplicateRecordIdError(id);
    }

    seen.add(id);
  }

  return lines;
};

const isChunkLine = (line: unknown): line is ChunkLine =>
  typeof line === "object" && line !== null && "id" in line && "entry" in line;

/** Read the persisted `chunkOffsets` JSON back as a typed array (defensive
 * against a null/legacy value — defaults to empty). */
const readOffsets = (dataset: DatasetMutationRecord): ChunkOffset[] =>
  Array.isArray(dataset.chunkOffsets) ? (dataset.chunkOffsets as unknown as ChunkOffset[]) : [];

/** Gate a mutation on `status='ready'` (Decision 6). Throws otherwise so a
 * still-preparing or failed dataset is never mutated under the lock. */
const assertReady = (dataset: DatasetMutationRecord): void => {
  if (dataset.status !== "ready") {
    throw new DatasetNotReadyError({
      status: dataset.status,
      statusError: dataset.statusError,
    });
  }
};

/**
 * Re-derive global per-chunk row offsets from a per-chunk (rowCount, byteSize)
 * list — every chunk's `startRow` is the running sum of prior chunks' rows. Used
 * after a delete so the offset index stays authoritative (I-COUNT).
 */
const recomputeOffsets = (
  chunks: Array<{ rowCount: number; byteSize: number }>,
): { offsets: ChunkOffset[]; rowCount: number; sizeBytes: number } => {
  const offsets: ChunkOffset[] = [];
  let startRow = 0;
  let sizeBytes = 0;
  chunks.forEach((c, index) => {
    const endRow = startRow + c.rowCount;
    offsets.push({ index, startRow, endRow, byteSize: c.byteSize });
    startRow = endRow;
    sizeBytes += c.byteSize;
  });

  return { offsets, rowCount: startRow, sizeBytes };
};

/**
 * Every write to a dataset stored as s3_jsonl chunks. `repository` is
 * process-scoped (a field); `storage` is resolved per project (an argument).
 * The lock and its transaction belong to the repository.
 */
export class DatasetChunkService {
  private constructor(private readonly datasets: DatasetContentRepository) {}

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

      const chunkCount = current.chunkCount ?? 0;
      const offsets = readOffsets(current);

      // Replace the row's entry at (index, rowIndex) in place and patch only that
      // chunk's byteSize — rows don't move on edit, so startRow/endRow are
      // unchanged. Shared by the fast and full-scan branches.
      const rewriteRowAt = async (
        index: number,
        rows: unknown[],
        rowIndex: number,
      ): Promise<void> => {
        const updatedRows = rows.slice();
        updatedRows[rowIndex] = { id: recordId, entry } satisfies ChunkLine;
        const offset = await datasetStorage.rewriteChunk({
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
      };

      // Fast path — the pre-scan located the row and the offset index covers every
      // chunk: re-read only that one chunk under the lock.
      if (hint?.locatedIds.has(recordId) && offsets.length === chunkCount) {
        const index = hint.affectedIndices[0]!;
        if (index < chunkCount) {
          const rows = await datasetStorage.readChunk({
            projectId,
            datasetId: dataset.id,
            index,
          });
          const rowIndex = rows.findIndex((line) => isChunkLine(line) && line.id === recordId);
          if (rowIndex !== -1) {
            await rewriteRowAt(index, rows, rowIndex);

            return { updated: true };
          }

          // Row moved/removed since the scan → fall through to the full scan.
          logger.warn(
            { projectId, datasetId: dataset.id, recordId, index },
            "edit fast-path drift: located row not in hinted chunk; falling back to full in-lock scan",
          );
        }
      }

      // Full in-lock scan (the proven path): read chunks in order until the id is
      // found; rewrite in place, or append as a new row when it exists nowhere.
      for (let index = 0; index < chunkCount; index++) {
        const rows = await datasetStorage.readChunk({
          projectId,
          datasetId: dataset.id,
          index,
        });
        const rowIndex = rows.findIndex((line) => isChunkLine(line) && line.id === recordId);
        if (rowIndex === -1) {
          continue;
        }

        await rewriteRowAt(index, rows, rowIndex);

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
        ? await this.locateIds({
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
        const fast = await (async (): Promise<{ deleted: number } | null> => {
          const removedIds = new Set<string>();
          const newRowCount = new Map<number, number>();
          const newByteSize = new Map<number, number>();
          // Buffer the rewrites; do NOT issue any S3 PUT until the hint is
          // re-validated, or a partial rewrite-then-bail would leave S3 mutated
          // while control falls through to the full in-lock scan.
          const pendingRewrites: Array<{ index: number; kept: unknown[] }> = [];
          let deleted = 0;
          for (const index of hint.affectedIndices) {
            if (index >= chunkCount) {
              continue;
            } // chunk trimmed away since the scan

            const rows = await datasetStorage.readChunk({
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

          if (deleted === 0) {
            return { deleted: 0 };
          }

          // Hint validated — now commit the buffered rewrites to S3.
          for (const { index, kept } of pendingRewrites) {
            const offset = await datasetStorage.rewriteChunk({
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

          return { deleted };
        })();
        if (fast) {
          return fast;
        }
      }

      // Full in-lock scan (the proven path): read every chunk, drop target rows,
      // recompute. Used on a legacy/no-offset dataset, or when the fast path
      // bailed on a hint discrepancy. Measures unaffected chunks from their actual
      // bytes, so this path also self-heals any pre-existing counter drift.
      const perChunk: Array<{ rowCount: number; byteSize: number }> = [];
      let deleted = 0;
      for (let index = 0; index < chunkCount; index++) {
        const rows = await datasetStorage.readChunk({
          projectId,
          datasetId: dataset.id,
          index,
        });
        const kept = rows.filter((line) => !(isChunkLine(line) && removeSet.has(line.id)));
        const removedHere = rows.length - kept.length;
        if (removedHere > 0) {
          deleted += removedHere;
          const offset = await datasetStorage.rewriteChunk({
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
    });
  }

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
      const current = await tx.findOneOrThrow({ id: datasetId, projectId });

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
      const current = await tx.findOneOrThrow({ id: dataset.id, projectId });
      assertReady(current);

      // Revalidate the SOURCE schema under the lock. `oldColumnTypes` was captured
      // before the lock; a concurrent column edit that already rewrote the chunks
      // to a different schema would make the remap below read those rows with the
      // stale schema and shift/drop values. Abort so the caller retries against the
      // now-current schema (no partial rewrite occurs — we bail before any write).
      if (JSON.stringify(current.columnTypes) !== JSON.stringify(oldColumnTypes)) {
        throw new DatasetConflictError(
          "Dataset columns changed since you opened the editor — please reopen and retry.",
          { reason: "stale_columns" },
        );
      }

      // In-memory rewrite guard: the rewrite buffers every row (+ converted copies)
      // while holding the lock. Above the cap, refuse rather than risk OOMing the
      // shared worker. Streaming chunk-by-chunk is the deferred fix.
      const currentSizeBytes = Number(current.sizeBytes ?? 0n);
      if (currentSizeBytes > MAX_INMEMORY_COLUMN_EDIT_BYTES) {
        throw new DatasetTooLargeToEditColumnsError({
          sizeBytes: currentSizeBytes,
          maxBytes: MAX_INMEMORY_COLUMN_EDIT_BYTES,
        });
      }

      const chunkCount = current.chunkCount ?? 0;
      const ids: string[] = [];
      const oldEntries: DatasetRecordEntry[] = [];
      for (let index = 0; index < chunkCount; index++) {
        const rows = await datasetStorage.readChunk({
          projectId,
          datasetId: dataset.id,
          index,
        });
        for (const line of rows) {
          if (isChunkLine(line)) {
            ids.push(line.id);
            oldEntries.push(line.entry as DatasetRecordEntry);
          }
        }
      }

      // Remap keys old→new, then convert each value to its new declared type.
      const remapped = tryToMapPreviousColumnsToNewColumns(
        oldEntries,
        oldColumnTypes,
        newColumnTypes,
      );
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
        if (isChunkLine(line) && remaining.has(line.id)) {
          affected.add(index);
          locatedIds.add(line.id);
          remaining.delete(line.id);
        }
      }
    }

    return { affectedIndices: [...affected].sort((a, b) => a - b), locatedIds };
  }

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
