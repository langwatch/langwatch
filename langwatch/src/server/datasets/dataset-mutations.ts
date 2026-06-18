/**
 * ADR-032 rung 6b — write-mutations (append / edit / delete) for datasets on the
 * `contentLayout='s3_jsonl'` layout. Every operation here mutates S3 chunk
 * objects AND the PG-authoritative counters (`rowCount`/`sizeBytes`/
 * `chunkCount`/`chunkOffsets`), so each runs inside the per-dataset advisory
 * lock (`withDatasetLock`, Decision 9 / I-COUNT): the chunk write and the
 * counter update commit as one atomic, serialized unit. Mutations are gated on
 * `status='ready'` (Decision 6) — a half-prepared dataset is never mutated.
 *
 * Decision 3:
 *   - append → new chunk(s) written from `chunkCount` (never rewrites existing);
 *   - edit/delete → rewrite only the affected chunk(s), located via the row
 *     offset index (here: a bounded in-order scan by row id — edits/deletes are
 *     rare, and the cost is one `readChunk` per chunk until the id is found).
 *
 * This is the single home for the s3_jsonl mutation logic; both the
 * `DatasetService` HTTP path and the tRPC editor path delegate here so the lock
 * + counter math live in exactly one place (no duplicated read-modify-write).
 */
import type { Dataset, Prisma, PrismaClient } from "@prisma/client";
import { nanoid } from "nanoid";
import { type ChunkOffset, toSingleJsonl } from "./dataset-chunking";
import { withDatasetLock } from "./dataset-lock";
import { type DatasetStorage, getDatasetStorage } from "./dataset-storage";
import { DatasetNotReadyError } from "./errors";

/** An s3_jsonl chunk line: the row entry tagged with a stable id so edit/delete
 * can target it. Mirrors the shape the normalize/append paths write. */
type ChunkLine = { id: string; entry: unknown };

const isChunkLine = (line: unknown): line is ChunkLine =>
  typeof line === "object" && line !== null && "id" in line && "entry" in line;

/** Read the persisted `chunkOffsets` JSON back as a typed array (defensive
 * against a null/legacy value — defaults to empty). */
const readOffsets = (dataset: Dataset): ChunkOffset[] =>
  Array.isArray(dataset.chunkOffsets)
    ? (dataset.chunkOffsets as unknown as ChunkOffset[])
    : [];

/** Gate a mutation on `status='ready'` (Decision 6). Throws otherwise so a
 * still-preparing or failed dataset is never mutated under the lock. */
const assertReady = (dataset: Dataset): void => {
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
 * after a delete (rows + bytes change) so the offset index stays authoritative
 * (I-COUNT). Also returns the totals.
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
 * Append lines within an already-locked transaction: write new chunk(s) from the
 * current `chunkCount` (never touching existing chunks) and extend the counters.
 * Shared by the public append and edit's create-on-miss branch so the lock +
 * counter math lives once. `forcedIds` pins the new rows' ids (upsert
 * semantics); otherwise a fresh id is minted per row.
 */
const appendLinesInTx = async ({
  tx,
  current,
  projectId,
  entries,
  storage,
  forcedIds,
}: {
  tx: Prisma.TransactionClient;
  current: Dataset;
  projectId: string;
  entries: unknown[];
  storage: DatasetStorage;
  forcedIds?: string[];
}): Promise<{ appended: number }> => {
  const lines: ChunkLine[] = entries.map((entry, i) => ({
    id: forcedIds?.[i] ?? `record_${nanoid()}`,
    entry,
  }));

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

  await tx.dataset.update({
    where: { id: current.id, projectId },
    data: {
      rowCount: oldRowCount + addedRows,
      sizeBytes: (current.sizeBytes ?? 0n) + BigInt(addedBytes),
      chunkCount: fromIndex + written.length,
      chunkOffsets: readOffsets(current).concat(
        newOffsets,
      ) as unknown as Prisma.InputJsonValue,
    },
  });

  return { appended: lines.length };
};

/**
 * Append rows to an s3_jsonl dataset under the advisory lock. Each row is
 * wrapped `{ id, entry }` so a later edit/delete can target it. Re-reads the
 * dataset inside the lock: the counters are authoritative and another serialized
 * mutation may have advanced them since the caller loaded the row.
 */
export const appendS3JsonlRecords = async ({
  prisma,
  dataset,
  projectId,
  entries,
  storage,
}: {
  prisma: PrismaClient;
  dataset: Dataset;
  projectId: string;
  entries: unknown[];
  storage?: DatasetStorage;
}): Promise<{ appended: number }> => {
  const datasetStorage = storage ?? (await getDatasetStorage(projectId));

  return withDatasetLock({ prisma, datasetId: dataset.id }, async (tx) => {
    const current = await tx.dataset.findFirstOrThrow({
      where: { id: dataset.id, projectId },
    });
    assertReady(current);
    return appendLinesInTx({
      tx,
      current,
      projectId,
      entries,
      storage: datasetStorage,
    });
  });
};

/**
 * Locate a row by id across the chunks (in order) and replace its `entry` in
 * place, rewriting only that one chunk and patching its offset/byteSize
 * (rowCount unchanged). If the id is not found in any chunk it is treated as a
 * new row → appended (upsert-of-new). Returns whether an existing row was
 * updated.
 */
export const editS3JsonlRecord = async ({
  prisma,
  dataset,
  projectId,
  recordId,
  entry,
  storage,
}: {
  prisma: PrismaClient;
  dataset: Dataset;
  projectId: string;
  recordId: string;
  entry: unknown;
  storage?: DatasetStorage;
}): Promise<{ updated: boolean }> => {
  const datasetStorage = storage ?? (await getDatasetStorage(projectId));

  return withDatasetLock({ prisma, datasetId: dataset.id }, async (tx) => {
    const current = await tx.dataset.findFirstOrThrow({
      where: { id: dataset.id, projectId },
    });
    assertReady(current);

    const chunkCount = current.chunkCount ?? 0;
    // Bounded in-order scan: read one chunk at a time until the id is found.
    // Edits are rare (Decision 3 — the editor path, not a hot loop), so the
    // per-chunk read cost is acceptable; a future reads-at-scale epic can index
    // id→chunk if needed.
    for (let index = 0; index < chunkCount; index++) {
      const rows = await datasetStorage.readChunk({
        projectId,
        datasetId: dataset.id,
        index,
      });
      const rowIndex = rows.findIndex(
        (line) => isChunkLine(line) && line.id === recordId,
      );
      if (rowIndex === -1) continue;

      const updatedRows = rows.slice();
      updatedRows[rowIndex] = { id: recordId, entry } satisfies ChunkLine;
      const offset = await datasetStorage.rewriteChunk({
        projectId,
        datasetId: dataset.id,
        index,
        records: updatedRows,
      });

      // Rows didn't move → every chunk's startRow/endRow is unchanged; patch
      // only the affected chunk's byteSize and shift sizeBytes by the delta.
      const offsets = readOffsets(current);
      const oldByteSize = offsets[index]?.byteSize ?? 0;
      const patched = offsets.map((o) =>
        o.index === index ? { ...o, byteSize: offset.byteSize } : o,
      );
      await tx.dataset.update({
        where: { id: dataset.id, projectId },
        data: {
          sizeBytes:
            (current.sizeBytes ?? 0n) + BigInt(offset.byteSize - oldByteSize),
          chunkOffsets: patched as unknown as Prisma.InputJsonValue,
        },
      });
      return { updated: true };
    }

    // Not an existing row → append it, pinning the requested id (matches the PG
    // upsertRecord / updateDatasetRecord create-on-miss path).
    await appendLinesInTx({
      tx,
      current,
      projectId,
      entries: [entry],
      storage: datasetStorage,
      forcedIds: [recordId],
    });
    return { updated: false };
  });
};

/**
 * Delete rows by id from an s3_jsonl dataset under the advisory lock: rewrite
 * each affected chunk without its removed rows, then recompute the offset index
 * for every chunk (their startRow/endRow shift down once an earlier chunk
 * shrinks) and decrement rowCount/sizeBytes. An affected chunk that becomes
 * empty is LEFT in place as an empty chunk (no compaction): `chunkCount` stays
 * authoritative and `readChunks` tolerates an empty chunk (parses to []), so
 * this is the simplest correct approach for the rung. Returns rows removed.
 */
export const deleteS3JsonlRecords = async ({
  prisma,
  dataset,
  projectId,
  recordIds,
  storage,
}: {
  prisma: PrismaClient;
  dataset: Dataset;
  projectId: string;
  recordIds: string[];
  storage?: DatasetStorage;
}): Promise<{ deleted: number }> => {
  const datasetStorage = storage ?? (await getDatasetStorage(projectId));
  const removeSet = new Set(recordIds);

  return withDatasetLock({ prisma, datasetId: dataset.id }, async (tx) => {
    const current = await tx.dataset.findFirstOrThrow({
      where: { id: dataset.id, projectId },
    });
    assertReady(current);

    const chunkCount = current.chunkCount ?? 0;
    const perChunk: Array<{ rowCount: number; byteSize: number }> = [];
    let deleted = 0;

    for (let index = 0; index < chunkCount; index++) {
      const rows = await datasetStorage.readChunk({
        projectId,
        datasetId: dataset.id,
        index,
      });
      const kept = rows.filter(
        (line) => !(isChunkLine(line) && removeSet.has(line.id)),
      );
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
        // Untouched on disk; measure its bytes from the in-memory rows so the
        // recomputed totals don't depend on a possibly-stale offset entry.
        perChunk.push({
          rowCount: rows.length,
          byteSize: toSingleJsonl(rows).byteSize,
        });
      }
    }

    if (deleted === 0) {
      return { deleted: 0 };
    }

    const {
      offsets: newOffsets,
      rowCount,
      sizeBytes,
    } = recomputeOffsets(perChunk);

    await tx.dataset.update({
      where: { id: dataset.id, projectId },
      data: {
        rowCount,
        sizeBytes: BigInt(sizeBytes),
        // chunkCount unchanged — empty chunks are kept (no compaction).
        chunkOffsets: newOffsets as unknown as Prisma.InputJsonValue,
      },
    });

    return { deleted };
  });
};
