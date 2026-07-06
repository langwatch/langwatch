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
 *
 * Layering: this is a domain module that sits BELOW `DatasetService` and ABOVE
 * `DatasetRepository` — routes never reach it, the service delegates here, and
 * every PG read/write of the `Dataset` row goes through the repository (passed
 * the lock's `tx`). The advisory-lock transaction is the unit of work; the
 * repository is the only thing that speaks Prisma.
 */
import type { Dataset, Prisma, PrismaClient } from "@prisma/client";
import { nanoid } from "nanoid";
import { tryToMapPreviousColumnsToNewColumns } from "~/optimization_studio/utils/datasetUtils";
import { createLogger } from "~/utils/logger/server";
import { DatasetRepository } from "./dataset.repository";
import {
  type ChunkedDatasetMeta,
  type ChunkOffset,
  chunkedMeta,
  chunkMetaOf,
  toSingleJsonl,
} from "./dataset-chunking";
import { withDatasetLock } from "./dataset-lock";
import { type DatasetStorage, getDatasetStorage } from "./dataset-storage";
import {
  DatasetConflictError,
  DatasetNotReadyError,
  DatasetTooLargeToEditColumnsError,
  DuplicateRecordIdError,
} from "./errors";
import { stripNullBytes } from "./sanitize";
import type { DatasetColumns, DatasetRecordEntry } from "./types";
import { convertRowsToColumnTypes } from "./upload-utils";

const logger = createLogger("langwatch:datasets:mutations");

/**
 * Byte ceiling for the in-memory column-type rewrite (ADR-032 v19). Above this
 * we refuse rather than buffer the whole dataset (+ converted copies) in heap
 * while holding the advisory lock. Set above the largest expected hand-edited
 * dataset; the deferred streaming rewrite lifts the cap entirely.
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
): ChunkLine[] => {
  const lines = entries.map((entry, i) => ({
    id: forcedIds?.[i] ?? `record_${nanoid()}`,
    entry: stripNullBytes(entry),
  }));
  // I-PG: row ids are unique within a dataset (the legacy PG PK). Minted ids
  // can't collide, but caller-supplied `forcedIds` can — a double-submit or
  // buggy SDK that repeats an id would persist two rows that edit/delete then
  // can't disambiguate. Reject the duplicate at the id-assignment chokepoint
  // rather than silently creating a ghost row. (Within-batch only: a cross-batch
  // collision against an already-stored id would need an O(rowCount) id scan on
  // every write — disproportionate; the edit create-on-miss path guards the
  // common upsert case.)
  const seen = new Set<string>();
  for (const { id } of lines) {
    if (seen.has(id)) throw new DuplicateRecordIdError(id);
    seen.add(id);
  }
  return lines;
};

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
  repository,
  current,
  projectId,
  entries,
  storage,
  forcedIds,
}: {
  tx: Prisma.TransactionClient;
  repository: DatasetRepository;
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

  await repository.update(
    {
      id: current.id,
      projectId,
      data: {
        rowCount: oldRowCount + addedRows,
        sizeBytes: (current.sizeBytes ?? 0n) + BigInt(addedBytes),
        chunkCount: fromIndex + written.length,
        chunkOffsets: readOffsets(current).concat(
          newOffsets,
        ) as unknown as Prisma.InputJsonValue,
      },
    },
    { tx },
  );

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
  repository: providedRepository,
}: {
  prisma: PrismaClient;
  dataset: Dataset;
  projectId: string;
  entries: unknown[];
  forcedIds?: (string | undefined)[];
  storage?: DatasetStorage;
  repository?: DatasetRepository;
}): Promise<{ appended: number }> => {
  const datasetStorage = storage ?? (await getDatasetStorage(projectId));
  const repository = providedRepository ?? new DatasetRepository(prisma);

  return withDatasetLock({ prisma, datasetId: dataset.id }, async (tx) => {
    const current = await repository.findOneOrThrow(
      { id: dataset.id, projectId },
      { tx },
    );
    assertReady(current);
    return appendLinesInTx({
      tx,
      repository,
      current,
      projectId,
      entries,
      forcedIds,
      storage: datasetStorage,
    });
  });
};

/**
 * Pre-lock locate scan (NO advisory lock held) for the scan-before-lock
 * optimization. Reads chunks in order — OFF the lock — to find which chunk
 * currently holds each of `ids`, stopping as soon as every id is located. The
 * edit/delete paths use this to shrink the lock-held work from O(chunkCount) S3
 * reads to O(affected chunks): the expensive locate runs here, off the lock, and
 * only the affected chunks are re-read + rewritten under the lock.
 *
 * The result is a HINT, never authoritative. A concurrent mutation between this
 * scan and lock acquisition can move or remove a row, so the caller re-validates
 * under the lock and bails to a full in-lock scan on any discrepancy — this scan
 * never decides correctness on its own. Returns `null` (→ caller takes the
 * proven full in-lock scan) when a chunk can't be cleanly read off the lock
 * (e.g. racing a concurrent rewrite), rather than acting on a partial locate.
 */
const locateIdsBeforeLock = async ({
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
}): Promise<{ affectedIndices: number[]; locatedIds: Set<string> } | null> => {
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
};

/**
 * Write the recomputed counters for a delete under the lock: a full offset
 * recompute from the final per-chunk `(rowCount, byteSize)` plus the trailing-
 * empty LOGICAL compaction (drop trailing 0-row chunks from `chunkCount` + the
 * offset index; objects are left as benign orphans — see `deleteS3JsonlRecords`).
 * Shared by the fast (affected-only) and full-scan delete paths so the
 * compaction/offset math lives in exactly one place.
 */
const commitDeleteCounts = async ({
  repository,
  tx,
  datasetId,
  projectId,
  perChunk,
}: {
  repository: DatasetRepository;
  tx: Prisma.TransactionClient;
  datasetId: string;
  projectId: string;
  perChunk: Array<{ rowCount: number; byteSize: number }>;
}): Promise<void> => {
  const { offsets, rowCount, sizeBytes } = recomputeOffsets(perChunk);
  let keptChunkCount = perChunk.length;
  while (keptChunkCount > 0 && perChunk[keptChunkCount - 1]!.rowCount === 0) {
    keptChunkCount -= 1;
  }
  const trimmed = keptChunkCount < perChunk.length;
  await repository.update(
    {
      id: datasetId,
      projectId,
      data: {
        rowCount,
        sizeBytes: BigInt(sizeBytes),
        // The trailing empty offset entries (startRow === endRow, byteSize 0)
        // contribute nothing to the totals, so slicing is exact.
        ...(trimmed
          ? {
              chunkCount: keptChunkCount,
              chunkOffsets: offsets.slice(
                0,
                keptChunkCount,
              ) as unknown as Prisma.InputJsonValue,
            }
          : {
              chunkOffsets: offsets as unknown as Prisma.InputJsonValue,
            }),
      },
    },
    { tx },
  );
};

/**
 * Locate a row by id and replace its `entry` in place, rewriting only that one
 * chunk and patching its offset/byteSize (rowCount unchanged). If the id is not
 * found in any chunk it is treated as a new row → appended (upsert-of-new).
 * Returns whether an existing row was updated.
 *
 * scan-before-lock: the O(chunkCount) locate runs OFF the advisory lock
 * (`locateIdsBeforeLock`); under the lock the fast path re-reads only the one
 * hinted chunk. If the row isn't there under the lock (a concurrent mutation
 * moved/removed it since the scan) the fast path falls through to the proven
 * full in-lock scan, so correctness never depends on the hint.
 */
export const editS3JsonlRecord = async ({
  prisma,
  dataset,
  projectId,
  recordId,
  entry,
  storage,
  repository: providedRepository,
}: {
  prisma: PrismaClient;
  dataset: Dataset;
  projectId: string;
  recordId: string;
  entry: unknown;
  storage?: DatasetStorage;
  repository?: DatasetRepository;
}): Promise<{ updated: boolean }> => {
  const datasetStorage = storage ?? (await getDatasetStorage(projectId));
  const repository = providedRepository ?? new DatasetRepository(prisma);

  // OFF the lock: locate the row's chunk so only that chunk is re-read under it.
  // Skipped unless the dataset looks ready — never do storage I/O ahead of the
  // readiness gate (the under-lock `assertReady` stays authoritative).
  const hint =
    dataset.status === "ready"
      ? await locateIdsBeforeLock({
          storage: datasetStorage,
          projectId,
          datasetId: dataset.id,
          ids: new Set([recordId]),
          chunkCount: dataset.chunkCount ?? 0,
        })
      : null;

  return withDatasetLock({ prisma, datasetId: dataset.id }, async (tx) => {
    const current = await repository.findOneOrThrow(
      { id: dataset.id, projectId },
      { tx },
    );
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
      await repository.update(
        {
          id: dataset.id,
          projectId,
          data: {
            sizeBytes:
              (current.sizeBytes ?? 0n) + BigInt(offset.byteSize - oldByteSize),
            chunkOffsets: patched as unknown as Prisma.InputJsonValue,
          },
        },
        { tx },
      );
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
        const rowIndex = rows.findIndex(
          (line) => isChunkLine(line) && line.id === recordId,
        );
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
      const rowIndex = rows.findIndex(
        (line) => isChunkLine(line) && line.id === recordId,
      );
      if (rowIndex === -1) continue;
      await rewriteRowAt(index, rows, rowIndex);
      return { updated: true };
    }

    // Not an existing row → append it, pinning the requested id (matches the PG
    // upsertRecord / updateDatasetRecord create-on-miss path).
    await appendLinesInTx({
      tx,
      repository,
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
 *
 * scan-before-lock: the O(chunkCount) locate runs OFF the advisory lock
 * (`locateIdsBeforeLock`); under the lock the fast path re-reads ONLY the
 * affected chunks and takes every unaffected chunk's `(rowCount, byteSize)` from
 * the authoritative offset index (no read), shrinking lock-held S3 reads from
 * O(chunkCount) to O(affected). The fast path only commits when the pre-scan
 * located every target id and the offset index covers every chunk, and it bails
 * to the proven full in-lock scan if any located id isn't where the hint said
 * (a concurrent move/delete since the scan) — so correctness never depends on
 * the hint. (Trusting the offset index for unaffected chunks means a delete no
 * longer incidentally self-heals counter drift on those chunks;
 * `recomputeDatasetCounts` remains the explicit I-COUNT repair.)
 */
export const deleteS3JsonlRecords = async ({
  prisma,
  dataset,
  projectId,
  recordIds,
  storage,
  repository: providedRepository,
}: {
  prisma: PrismaClient;
  dataset: Dataset;
  projectId: string;
  recordIds: string[];
  storage?: DatasetStorage;
  repository?: DatasetRepository;
}): Promise<{ deleted: number }> => {
  const datasetStorage = storage ?? (await getDatasetStorage(projectId));
  const repository = providedRepository ?? new DatasetRepository(prisma);
  const removeSet = new Set(recordIds);
  const isTarget = (line: unknown): boolean =>
    isChunkLine(line) && removeSet.has(line.id);

  // OFF the lock: locate the target ids' chunks so only the affected chunks are
  // re-read under the lock (not all chunkCount). Skipped for a not-ready dataset
  // — never do storage I/O ahead of the readiness gate (the under-lock
  // `assertReady` stays authoritative).
  const hint =
    removeSet.size > 0 && dataset.status === "ready"
      ? await locateIdsBeforeLock({
          storage: datasetStorage,
          projectId,
          datasetId: dataset.id,
          ids: removeSet,
          chunkCount: dataset.chunkCount ?? 0,
        })
      : null;

  return withDatasetLock({ prisma, datasetId: dataset.id }, async (tx) => {
    const current = await repository.findOneOrThrow(
      { id: dataset.id, projectId },
      { tx },
    );
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
    if (
      hint &&
      hint.locatedIds.size === removeSet.size &&
      offsets.length === chunkCount
    ) {
      const fast = await (async (): Promise<{ deleted: number } | null> => {
        const removedIds = new Set<string>();
        const newRowCount = new Map<number, number>();
        const newByteSize = new Map<number, number>();
        // Buffer the rewrites; do NOT issue any S3 PUT until the hint is
        // re-validated. Otherwise a partial rewrite-then-bail would leave a
        // chunk mutated while control falls through to the full in-lock scan,
        // which then re-reads the already-mutated chunk and under-reports
        // `deleted` (and redundantly re-PUTs it). On bail we must leave S3
        // untouched so the full scan owns every write and the count.
        const pendingRewrites: Array<{ index: number; kept: unknown[] }> = [];
        let deleted = 0;
        for (const index of hint.affectedIndices) {
          if (index >= chunkCount) continue; // chunk trimmed away since the scan
          const rows = await datasetStorage.readChunk({
            projectId,
            datasetId: dataset.id,
            index,
          });
          const kept = rows.filter((line) => !isTarget(line));
          if (kept.length === rows.length) continue; // none of ours here now
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
        await commitDeleteCounts({
          repository,
          tx,
          datasetId: dataset.id,
          projectId,
          perChunk,
        });
        return { deleted };
      })();
      if (fast) return fast;
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
        perChunk.push({
          rowCount: rows.length,
          byteSize: toSingleJsonl(rows).byteSize,
        });
      }
    }

    if (deleted === 0) {
      return { deleted: 0 };
    }
    await commitDeleteCounts({
      repository,
      tx,
      datasetId: dataset.id,
      projectId,
      perChunk,
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
  repository: providedRepository,
}: {
  prisma: PrismaClient;
  datasetId: string;
  projectId: string;
  storage?: DatasetStorage;
  repository?: DatasetRepository;
}): Promise<RecomputedDatasetCounts> => {
  const datasetStorage = storage ?? (await getDatasetStorage(projectId));
  const repository = providedRepository ?? new DatasetRepository(prisma);

  return withDatasetLock({ prisma, datasetId }, async (tx) => {
    const current = await repository.findOneOrThrow(
      { id: datasetId, projectId },
      { tx },
    );

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
    // same LOGICAL compaction `deleteS3JsonlRecords` does — so repair is fully
    // idempotent and `chunkCount` doesn't keep over-counting trailing empties
    // across repeated repair runs. The trailing objects are left as benign 0-byte
    // orphans (no in-tx delete: reads are lock-free, the next append overwrites
    // them by key) — identical reasoning to the delete path's trim.
    let keptChunkCount = perChunk.length;
    while (keptChunkCount > 0 && perChunk[keptChunkCount - 1]!.rowCount === 0) {
      keptChunkCount -= 1;
    }
    const keptOffsets = offsets.slice(0, keptChunkCount);

    await repository.update(
      {
        id: datasetId,
        projectId,
        data: {
          rowCount,
          sizeBytes: BigInt(sizeBytes),
          chunkCount: keptChunkCount,
          chunkOffsets: keptOffsets as unknown as Prisma.InputJsonValue,
        },
      },
      { tx },
    );

    return {
      rowCount,
      sizeBytes,
      chunkCount: keptChunkCount,
      chunkOffsets: keptOffsets,
    };
  });
};

/**
 * Change an s3_jsonl dataset's column schema (rename / retype / add / remove)
 * under the advisory lock (ADR-032 v19). The legacy PG path migrates records via
 * `migrateDatasetRecordColumns`; the s3 equivalent is a full chunk rewrite:
 *   1. read every row (id + entry) across all chunks,
 *   2. remap keys old→new (exact-name then by-position, the SAME
 *      `tryToMapPreviousColumnsToNewColumns` the PG path uses — so renames keep
 *      data, removed columns drop, added columns are absent),
 *   3. convert each value to its new column type (`convertRowsToColumnTypes` —
 *      text→number/json/date/etc.; `image` is a URL string, so a text→image
 *      change keeps the value verbatim and only the column's declared type
 *      changes),
 *   4. rewrite chunks from index 0 (row ids preserved via `forcedIds`), reap any
 *      orphan chunks past the new count (converted rows may pack into fewer),
 *   5. update counters + `columnTypes` + name/slug in the lock's tx.
 *
 * Memory: step 1 buffers all rows (bounded by dataset size) — the same shape as
 * the PG record migrator this replaces, and the operation is a deliberate,
 * user-driven edit, not the unbounded upload path (so it is NOT held to the
 * normalize job's streaming I-MEM contract). A streaming chunk-by-chunk rewrite
 * is a future optimization if multi-GB column edits become common.
 */
export const migrateS3JsonlColumns = async ({
  prisma,
  dataset,
  projectId,
  oldColumnTypes,
  newColumnTypes,
  name,
  slug,
  storage,
  repository: providedRepository,
}: {
  prisma: PrismaClient;
  dataset: Dataset;
  projectId: string;
  oldColumnTypes: DatasetColumns;
  newColumnTypes: DatasetColumns;
  name: string;
  slug: string;
  storage?: DatasetStorage;
  repository?: DatasetRepository;
}): Promise<Dataset> => {
  const datasetStorage = storage ?? (await getDatasetStorage(projectId));
  const repository = providedRepository ?? new DatasetRepository(prisma);

  return withDatasetLock({ prisma, datasetId: dataset.id }, async (tx) => {
    const current = await repository.findOneOrThrow(
      { id: dataset.id, projectId },
      { tx },
    );
    assertReady(current);

    // Revalidate the SOURCE schema under the lock. `oldColumnTypes` was captured
    // before the lock; a concurrent column edit that already rewrote the chunks
    // to a different schema would make the remap below read those rows with the
    // stale schema and shift/drop values. Abort so the caller retries against the
    // now-current schema (no partial rewrite occurs — we bail before any write).
    if (
      JSON.stringify(current.columnTypes) !== JSON.stringify(oldColumnTypes)
    ) {
      throw new DatasetConflictError(
        "Dataset columns changed since you opened the editor — please reopen and retry.",
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
    // FAILURE (safe only for a rowless CREATE) — on this LIVE dataset that would
    // delete existing content on a transient error. We write directly and do NOT
    // delete on failure: a retype is row-count-stable, so a partial overwrite
    // keeps every row addressable, the lock's tx rolls PG back, and
    // `recomputeDatasetCounts` can repair byte drift. Orphan chunks past the new
    // (possibly smaller) count are reaped only AFTER a clean write.
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

    return await repository.update(
      {
        id: dataset.id,
        projectId,
        data: {
          name,
          slug,
          columnTypes: newColumnTypes as unknown as Prisma.InputJsonValue,
          rowCount: meta.rowCount,
          sizeBytes: BigInt(meta.sizeBytes),
          chunkCount: meta.chunkCount,
          chunkOffsets: meta.chunkOffsets as unknown as Prisma.InputJsonValue,
        },
      },
      { tx },
    );
  });
};
