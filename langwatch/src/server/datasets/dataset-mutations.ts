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
import {
  type ChunkedDatasetMeta,
  type ChunkOffset,
  chunkedMeta,
  chunkMetaOf,
  toSingleJsonl,
} from "./dataset-chunking";
import { withDatasetLock } from "./dataset-lock";
import { type DatasetStorage, getDatasetStorage } from "./dataset-storage";
import { DatasetNotReadyError } from "./errors";
import { stripNullBytes } from "./sanitize";

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
 * (`record_<nanoid>`) the later edit/delete can target, and scrub U+0000 from
 * the entry (I-NULL — Postgres-parity). `forcedIds` pins each new row's id —
 * per-row and optional: a defined entry honors the caller's id, an `undefined`
 * one (or a short/absent array) mints a fresh id. The single home for the batch
 * `{id,entry}`+null-scrub wrap shared by the append and born-on-storage paths
 * (the streaming normalize writer mints ids per row as it goes, so it stays
 * separate).
 */
const toChunkLines = (
  entries: unknown[],
  { forcedIds }: { forcedIds?: (string | undefined)[] } = {},
): ChunkLine[] =>
  entries.map((entry, i) => ({
    id: forcedIds?.[i] ?? `record_${nanoid()}`,
    entry: stripNullBytes(entry),
  }));

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
  forcedIds?: (string | undefined)[];
}): Promise<{ appended: number }> => {
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
 * Born-on-storage (ADR-032 cutover step 1): write a brand-new dataset's records
 * directly to chunk objects from index 0 and return the PG-authoritative
 * `ChunkedDatasetMeta` (rowCount / sizeBytes / chunkCount / chunkOffsets) the
 * caller stamps onto the `Dataset` row.
 *
 * No advisory lock and no transaction: the row does not exist yet (this runs
 * BEFORE `repository.create`, not inside `withDatasetLock`), so there is nothing
 * to serialize against. Writing the chunks first means a write failure throws
 * and leaves no orphan row — the atomicity the create path relies on. Owns its
 * own storage resolution (`getDatasetStorage`) when not passed, mirroring the
 * sibling append/edit/delete mutations.
 *
 * Self-cleaning on a partial write: both storage backends write chunks
 * sequentially, so a multi-chunk write can persist chunk 0 and then fail on
 * chunk 1 — leaving rowless orphan objects (customer content with no row to
 * govern retention/deletion). On any write failure we best-effort reap the whole
 * `0..k` prefix (`deleteChunksFrom(fromIndex: 0)`) before rethrowing, so the
 * function never leaks objects regardless of which caller invokes it.
 *
 * `forcedIds` honors caller-supplied per-row ids (parity with the append path);
 * a fresh `record_<nanoid>` is minted wherever an id is absent.
 */
export const writeInitialS3JsonlChunks = async ({
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
  storage?: DatasetStorage;
}): Promise<ChunkedDatasetMeta> => {
  const datasetStorage = storage ?? (await getDatasetStorage(projectId));

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
};

/**
 * Best-effort delete of ALL chunk objects of a dataset (from index 0). The
 * born-on-storage create (`writeInitialS3JsonlChunks`) writes chunks BEFORE
 * inserting the row; if the row insert then fails (slug race → unique violation,
 * DB outage) this reaps the orphaned objects so customer content isn't left in
 * storage with no row to govern its retention/deletion. No lock, no counters —
 * there is no row to serialize against or update.
 */
export const deleteAllS3JsonlChunks = async ({
  projectId,
  datasetId,
  storage,
}: {
  projectId: string;
  datasetId: string;
  storage?: DatasetStorage;
}): Promise<void> => {
  const datasetStorage = storage ?? (await getDatasetStorage(projectId));
  await datasetStorage.deleteChunksFrom({ projectId, datasetId, fromIndex: 0 });
};

/**
 * Append rows to an s3_jsonl dataset under the advisory lock. Each row is
 * wrapped `{ id, entry }` so a later edit/delete can target it. Re-reads the
 * dataset inside the lock: the counters are authoritative and another serialized
 * mutation may have advanced them since the caller loaded the row.
 *
 * `forcedIds` honors caller-supplied per-row ids (index-aligned, optional) so a
 * batch-create that mints + RETURNS ids persists those exact ids — otherwise the
 * returned ids wouldn't exist in storage and a follow-up edit/delete by id would
 * miss. A fresh `record_<nanoid>` is minted wherever an id is absent.
 */
export const appendS3JsonlRecords = async ({
  prisma,
  dataset,
  projectId,
  entries,
  forcedIds,
  storage,
}: {
  prisma: PrismaClient;
  dataset: Dataset;
  projectId: string;
  entries: unknown[];
  forcedIds?: (string | undefined)[];
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
      forcedIds,
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
    // m3: the advisory-lock + PG-connection hold time scales with `chunkCount`
    // (this id-scan does O(chunkCount) S3 reads inside the lock) — acceptable
    // because edits are rare; a hot path would need an id→chunk index instead.
    // The transaction timeout is widened (see `withDatasetLock`) so this scan
    // can't P2028 on a multi-chunk dataset.
    // TODO(scan-before-lock): the O(chunkCount) locate-scan could run BEFORE
    // entering the lock, then re-read only the target chunk under the lock
    // before rewriting — shrinking lock-hold to the rewrite + counter-write.
    // Deferred: it risks the serialization guarantee if done carelessly (the
    // target chunk may move between scan and lock), so it needs its own rung.
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

    // m3: the advisory-lock + PG-connection hold time scales with `chunkCount` —
    // this scan reads every chunk inside the lock (O(chunkCount) S3 reads).
    // Acceptable because deletes are rare; a hot path would need an id→chunk index.
    // The transaction timeout is widened (see `withDatasetLock`) so this scan
    // can't P2028 on a multi-chunk dataset.
    // TODO(scan-before-lock): the locate-scan could run BEFORE the lock and only
    // the affected-chunk rewrites + counter-write run under it — deferred for the
    // same serialization-safety reason noted on `editS3JsonlRecord`.
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

    // Compaction (cheap, trailing-only, LOGICAL): a delete that empties the
    // highest-index chunks lets us drop them from `chunkCount` + the offset index
    // so reads stop iterating empty chunks and `chunkCount` doesn't grow unbounded
    // under churn. We deliberately do NOT delete the chunk objects here: an S3
    // delete inside this transaction would land before the lowered `chunkCount`
    // commits, and reads are lock-free — a reader could see the old count and then
    // hit the now-missing object (a hard `MissingChunkError`). Instead the
    // trailing objects are left as benign 0-byte orphans: readers ignore them
    // (they iterate `0..chunkCount`), the next append overwrites them by key
    // (`writeChunks(fromIndex=chunkCount)`), and physical reap is the deferred
    // compaction's job. Trailing-only regardless: a MIDDLE empty must stay in
    // place (chunk keys are positional; removing it would re-index every chunk
    // above it).
    let keptChunkCount = perChunk.length;
    while (keptChunkCount > 0 && perChunk[keptChunkCount - 1]!.rowCount === 0) {
      keptChunkCount -= 1;
    }
    const trimmed = keptChunkCount < perChunk.length;

    await tx.dataset.update({
      where: { id: dataset.id, projectId },
      data: {
        rowCount,
        sizeBytes: BigInt(sizeBytes),
        // The trailing empty offset entries (startRow === endRow, byteSize 0)
        // contribute nothing to the totals, so slicing is exact.
        ...(trimmed
          ? {
              chunkCount: keptChunkCount,
              chunkOffsets: newOffsets.slice(
                0,
                keptChunkCount,
              ) as unknown as Prisma.InputJsonValue,
            }
          : {
              chunkOffsets: newOffsets as unknown as Prisma.InputJsonValue,
            }),
      },
    });

    return { deleted };
  });
};

/**
 * I-COUNT repair: re-derive the PG-authoritative counters from S3 truth. Reads
 * every chunk's actual bytes (`readChunk` per index, driven by `chunkCount`) and
 * recomputes `rowCount`/`sizeBytes`/`chunkOffsets` from what's really on disk,
 * then writes them back onto the Dataset row under the advisory lock.
 *
 * Runnable on a detected mismatch — the residual repair for the rare
 * PG-commit-after-S3-write failure on edit/delete, where the chunk is mutated
 * but the counters rolled back (Consequences → Negative: I-COUNT is eventually
 * consistent / repairable, not unconditionally atomic). `chunkCount` is trusted
 * as the chunk-set boundary: every chunk in `0..chunkCount` MUST exist — a
 * missing one is corruption, not emptiness, so `readChunk` throws
 * `MissingChunkError` and we propagate it rather than silently dropping the tail
 * (which would re-derive a smaller `chunkCount` and mask data loss when a middle
 * chunk is gone but later chunks survive). Returns the recomputed counts.
 */
export const recomputeDatasetCounts = async ({
  prisma,
  datasetId,
  projectId,
  storage,
}: {
  prisma: PrismaClient;
  datasetId: string;
  projectId: string;
  storage?: DatasetStorage;
}): Promise<RecomputedDatasetCounts> => {
  const datasetStorage = storage ?? (await getDatasetStorage(projectId));

  return withDatasetLock({ prisma, datasetId }, async (tx) => {
    const current = await tx.dataset.findFirstOrThrow({
      where: { id: datasetId, projectId },
    });

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

    await tx.dataset.update({
      where: { id: datasetId, projectId },
      data: {
        rowCount,
        sizeBytes: BigInt(sizeBytes),
        chunkCount,
        chunkOffsets: offsets as unknown as Prisma.InputJsonValue,
      },
    });

    return { rowCount, sizeBytes, chunkCount, chunkOffsets: offsets };
  });
};
