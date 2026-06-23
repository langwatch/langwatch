import type { Dataset, DatasetRecord, Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import type { ChunkOffset } from "../../datasets/dataset-chunking";
import { appendS3JsonlRecords } from "../../datasets/dataset-mutations";
import {
  type DatasetStorage,
  getDatasetStorage,
} from "../../datasets/dataset-storage";
import {
  DatasetChunkCountMissingError,
  DatasetNotReadyError,
  DatasetTooLargeToExportError,
} from "../../datasets/errors";
import { stripNullBytes } from "../../datasets/sanitize";
import type { DatasetRecordInput } from "../../datasets/types";
import { prisma } from "../../db";
import { StorageService } from "../../storage";

const storageService = new StorageService();

/**
 * Safe ceiling for a full (unbounded) s3_jsonl export (`limitMb: null`). The
 * `download` path asks for the whole dataset; on a multi-GB dataset that would
 * materialize the entire file in heap and OOM the pod (I-MEM). Until the
 * streaming-export fast-follow epic ships, reject a full export of a dataset
 * whose PG-authoritative `sizeBytes` exceeds this with a clear, typed error
 * (`DatasetTooLargeToExportError`) instead of trying to read it.
 *
 * FAST-FOLLOW: true streaming/batched export (read chunks → stream to the
 * client without buffering) is the reads-at-scale epic; this is the bounded
 * guard that keeps the pod alive in the meantime.
 */
export const DATASET_FULL_EXPORT_MAX_BYTES = 100 * 1024 * 1024;

/**
 * Guard an UNBOUNDED full-corpus read (`readChunks` over every chunk) against
 * OOM. The bounded readers cap at a byte budget, but three paths materialise the
 * whole dataset at once — the legacy no-offsets fallbacks (single-row select and
 * paginated list) and `copyDataset`. Reject a dataset too large to hold in heap
 * with the same typed error the export path uses, rather than OOMing the pod.
 * (Upload caps don't bound this: a dataset grows past 25 MB via repeated
 * appends, so `sizeBytes` is the only real ceiling.)
 */
export const assertDatasetReadableInHeap = (dataset: {
  sizeBytes: bigint | null;
}): void => {
  const sizeBytes = Number(dataset.sizeBytes ?? 0n);
  if (sizeBytes > DATASET_FULL_EXPORT_MAX_BYTES) {
    throw new DatasetTooLargeToExportError({
      sizeBytes,
      maxBytes: DATASET_FULL_EXPORT_MAX_BYTES,
    });
  }
};

const createDatasetRecords = ({
  entries,
  datasetId,
  projectId,
  useS3 = false,
}: {
  entries: DatasetRecordInput[];
  datasetId: string;
  projectId: string;
  useS3?: boolean;
}) => {
  return entries.map((entry, index) => {
    const { id: entryId, ...entryWithoutId } = entry;
    const id = entryId ?? nanoid();

    const record = {
      id,
      entry: stripNullBytes(entryWithoutId) as Record<string, unknown>,
      datasetId,
      createdAt: new Date(),
      updatedAt: new Date(),
      projectId,
    };

    if (useS3) {
      return {
        ...record,
        position: (index + 1) * 1000,
      };
    }

    return record;
  });
};

export const createManyDatasetRecords = async ({
  datasetId,
  projectId,
  datasetRecords,
  tx,
}: {
  datasetId: string;
  projectId: string;
  // Input records - IDs are optional (backend generates with nanoid)
  datasetRecords: DatasetRecordInput[];
  // Optional transaction client. When provided, all DB reads/writes for the
  // Postgres path are joined to the caller's transaction so that a failure in
  // record insertion can roll back the parent dataset row.
  tx?: Prisma.TransactionClient;
}) => {
  const db = tx ?? prisma;
  const dataset = await db.dataset.findFirst({
    where: { id: datasetId, projectId },
  });

  if (!dataset) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Dataset not found",
    });
  }

  // ADR-032 rung 6b: an s3_jsonl dataset appends to chunk objects (new chunks
  // from `chunkCount`) under the per-dataset advisory lock (Decision 9), not the
  // PG table (I-PG). A caller-supplied row id is HONORED via `forcedIds` (parity
  // with the create path and the PG/create-on-miss behavior); a fresh
  // `record_<nanoid>` is minted only where an id is absent. The U+0000 scrub
  // (I-NULL) happens inside the mutation (`toChunkLines`). Replaces the dead
  // single-blob `useS3` path below for the new layout. `tx` does not apply — the
  // mutation owns its own advisory-locked transaction; createNewDataset only
  // ever creates `postgres` datasets, so a tx is never paired with s3_jsonl.
  if (dataset.contentLayout === "s3_jsonl") {
    const entriesWithoutId = datasetRecords.map((entry) => {
      const { id: _id, ...entryWithoutId } = entry;
      return entryWithoutId;
    });
    await appendS3JsonlRecords({
      prisma,
      dataset,
      projectId,
      entries: entriesWithoutId,
      forcedIds: datasetRecords.map((record) => record.id),
    });
    return { success: true } as const;
  }

  if (dataset.useS3) {
    const recordData = createDatasetRecords({
      entries: datasetRecords,
      datasetId,
      projectId,
      useS3: true,
    });

    let existingRecords: any[] = [];
    try {
      const { records: fetchedRecords } = await storageService.getObject(
        projectId,
        datasetId,
      );
      existingRecords = fetchedRecords;
    } catch (error) {
      if ((error as any).name !== "NoSuchKey") {
        captureException(toError(error));
        throw error;
      }
    }

    // Combine existing and new records
    const allRecords = [...existingRecords, ...recordData];

    await storageService.putObject(
      projectId,
      datasetId,
      JSON.stringify(allRecords),
    );

    await db.dataset.update({
      where: { id: datasetId, projectId },
      data: { s3RecordCount: allRecords.length },
    });

    return { success: true };
  } else {
    const recordData = createDatasetRecords({
      entries: datasetRecords,
      datasetId,
      projectId,
    });

    return db.datasetRecord.createMany({
      data: recordData as (DatasetRecord & { entry: any })[],
    });
  }
};

const processBatchedRecords = ({
  records,
  limitMb,
  totalSize = 0,
}: {
  records: DatasetRecord[];
  limitMb: number | null;
  totalSize?: number;
}) => {
  const truncatedRecords: DatasetRecord[] = [];
  let truncated = false;

  for (const record of records) {
    const recordSize = JSON.stringify(record.entry).length;
    if (!limitMb || totalSize + recordSize < limitMb * 1024 * 1024) {
      truncatedRecords.push(record);
      totalSize += recordSize;
    } else {
      truncated = true;
      break;
    }
  }

  return { truncatedRecords, truncated, totalSize };
};

type EntrySelection = "first" | "last" | "random" | "all" | number;

/**
 * Adapt an s3_jsonl chunk line `{ id, entry }` into the `DatasetRecord` shape
 * consumers expect (`record.id` + `record.entry`). Timestamps come from the
 * dataset row — individual rows don't carry their own. Defensive against legacy
 * raw-row lines (no `id`/`entry` wrapper) by treating the whole line as the
 * entry and minting an id.
 */
export const adaptS3JsonlRecord = (
  line: unknown,
  dataset: Pick<Dataset, "id" | "projectId" | "createdAt" | "updatedAt">,
): DatasetRecord => {
  const wrapped =
    line && typeof line === "object" && "entry" in line
      ? (line as { id?: string; entry: unknown })
      : { id: undefined, entry: line };

  return {
    id: wrapped.id ?? `record_${nanoid()}`,
    entry: wrapped.entry as Prisma.JsonValue,
    datasetId: dataset.id,
    projectId: dataset.projectId,
    createdAt: dataset.createdAt,
    updatedAt: dataset.updatedAt,
  };
};

/**
 * Apply the same `entrySelection` semantics the PG path uses, in-memory. For
 * first/last/random/number it returns the single selected record; for "all" it
 * returns every record. Mirrors the PG branch's skip arithmetic so consumers
 * see identical behaviour regardless of `contentLayout`.
 */
const selectRecords = (
  records: DatasetRecord[],
  entrySelection: EntrySelection,
): DatasetRecord[] => {
  if (entrySelection === "all") {
    return records;
  }

  const count = records.length;
  if (count === 0) {
    return [];
  }

  let index = 0;
  if (entrySelection === "first") {
    index = 0;
  } else if (entrySelection === "last") {
    index = Math.max(count - 1, 0);
  } else if (entrySelection === "random") {
    index = Math.floor(Math.random() * count);
  } else {
    index = Math.max(0, Math.min(entrySelection, count - 1));
  }

  return [records[index]!];
};

/** Read the persisted `chunkOffsets` JSON back as a typed array (defensive
 * against a null/legacy value — defaults to empty). */
const readOffsets = (dataset: Pick<Dataset, "chunkOffsets">): ChunkOffset[] =>
  Array.isArray(dataset.chunkOffsets)
    ? (dataset.chunkOffsets as unknown as ChunkOffset[])
    : [];

/**
 * Resolve a single-row `entrySelection` to one record by reading ONLY the chunk
 * that holds it — the O(1)-chunk short-circuit the PG path gets for free via
 * `skip`/`take`. Uses the PG-authoritative `chunkOffsets` (row position → chunk)
 * so a single-row read never pulls the whole dataset into memory:
 *   - "first"  → chunk 0, row 0
 *   - "last"   → last chunk, its last row
 *   - number N → the chunk whose `[startRow,endRow)` contains N, row N-startRow
 *   - "random" → a random index in [0, rowCount), then same as number
 * Falls back to reading all chunks (caller's slow path) when offsets are missing
 * (legacy/never-written) or the resolved index lands outside the offset index —
 * defensive, so a drifted offset never serves the wrong row silently.
 * Returns `null` to signal "no short-circuit possible, use the full read".
 */
const selectS3JsonlRecordViaOffsets = async ({
  dataset,
  projectId,
  storage,
  entrySelection,
}: {
  dataset: Dataset;
  projectId: string;
  storage: DatasetStorage;
  entrySelection: "first" | "last" | "random" | number;
}): Promise<DatasetRecord | null> => {
  const offsets = readOffsets(dataset);
  const rowCount = dataset.rowCount ?? 0;
  const chunkCount = dataset.chunkCount ?? 0;
  if (offsets.length === 0 || chunkCount === 0 || rowCount === 0) {
    return null;
  }

  // Resolve the global row index to read.
  let targetRow: number;
  if (entrySelection === "first") {
    targetRow = 0;
  } else if (entrySelection === "last") {
    targetRow = rowCount - 1;
  } else if (entrySelection === "random") {
    targetRow = Math.floor(Math.random() * rowCount);
  } else {
    targetRow = Math.max(0, Math.min(entrySelection, rowCount - 1));
  }

  // Find the chunk whose [startRow, endRow) contains the target row.
  const offset = offsets.find(
    (o) => targetRow >= o.startRow && targetRow < o.endRow,
  );
  if (!offset) {
    return null;
  }

  const rows = await storage.readChunk({
    projectId,
    datasetId: dataset.id,
    index: offset.index,
  });
  const within = targetRow - offset.startRow;
  const line = rows[within];
  if (line === undefined) {
    return null;
  }
  return adaptS3JsonlRecord(line, dataset);
};

/**
 * Read the head (first up-to-5 rows) of an s3_jsonl dataset for the preview,
 * gated on `status='ready'` (ADR-032 Decision 6 / I-READY). Reads the first
 * NON-EMPTY chunk(s) — never the whole dataset — and reports the PG-authoritative
 * count. Extracted from the `getHead` tRPC procedure so the s3_jsonl read path
 * is unit-testable at its boundaries (prisma already resolved the row).
 *
 * Reads the first non-empty chunk(s), not literally chunk 0: a delete that
 * empties all of chunk 0 while later chunks keep rows leaves chunk 0 empty in
 * place (compaction is trailing-only, ADR-032 D3 / `deleteS3JsonlRecords`), so
 * reading only chunk 0 would render an empty preview against a positive total.
 * The `chunkOffsets` index marks each chunk's row range (`endRow > startRow` ⇒
 * non-empty), so empty leading/middle chunks are skipped without being read.
 *
 * @throws {DatasetNotReadyError} if the dataset is not `ready`.
 */
export const readDatasetHeadS3Jsonl = async ({
  dataset,
  projectId,
}: {
  dataset: Dataset;
  projectId: string;
}): Promise<{ records: DatasetRecord[]; total: number }> => {
  if (dataset.status !== "ready") {
    throw new DatasetNotReadyError({
      status: dataset.status,
      statusError: dataset.statusError,
    });
  }

  const storage = await getDatasetStorage(projectId);
  const HEAD_LIMIT = 5;
  const chunkCount = dataset.chunkCount ?? 0;
  const offsets = readOffsets(dataset);

  const records: DatasetRecord[] = [];
  const pushRows = (rows: unknown[]): void => {
    for (const line of rows) {
      if (records.length >= HEAD_LIMIT) return;
      records.push(adaptS3JsonlRecord(line, dataset));
    }
  };

  if (offsets.length > 0) {
    // Offset index present: read only the chunks it marks non-empty, in order,
    // until the preview is full — empty leading/middle chunks are skipped
    // without a read.
    for (const offset of offsets) {
      if (records.length >= HEAD_LIMIT) break;
      if (offset.endRow <= offset.startRow) continue;
      pushRows(
        await storage.readChunk({
          projectId,
          datasetId: dataset.id,
          index: offset.index,
        }),
      );
    }
  } else {
    // Legacy/never-written offsets: scan chunks in order, skipping empties,
    // until the preview is full. Still bounded — stops at the first chunk(s)
    // that fill it, never reads the whole dataset.
    for (
      let index = 0;
      index < chunkCount && records.length < HEAD_LIMIT;
      index++
    ) {
      pushRows(
        await storage.readChunk({ projectId, datasetId: dataset.id, index }),
      );
    }
  }

  return {
    records,
    total: dataset.rowCount ?? records.length,
  };
};

export const getFullDataset = async ({
  datasetId,
  projectId,
  entrySelection = "all",
  limitMb = 5,
}: {
  datasetId: string;
  projectId: string;
  entrySelection?: EntrySelection;
  limitMb?: number | null;
}): Promise<
  | (Dataset & {
      datasetRecords: DatasetRecord[];
      truncated?: boolean;
      count: number;
    })
  | null
> => {
  const dataset = await prisma.dataset.findFirst({
    where: { id: datasetId, projectId },
  });

  if (!dataset) {
    return null;
  }

  const truncatedDatasetRecords: DatasetRecord[] = [];

  const BATCH_SIZE = 500;

  // ADR-032 Decision 6 / I-READY: the s3_jsonl content layout reads from chunk
  // objects, gated on `status='ready'`. Routed independently of the dead
  // single-blob `useS3` path. Postgres datasets default `status:"ready"`, so the
  // gate never fires for legacy data.
  if (dataset.contentLayout === "s3_jsonl") {
    if (dataset.status !== "ready") {
      throw new DatasetNotReadyError({
        status: dataset.status,
        statusError: dataset.statusError,
      });
    }

    // I-COUNT: a `ready` s3_jsonl dataset MUST have a non-null chunkCount.
    // `chunkCount ?? 0` below would otherwise loop zero times and serve an EMPTY
    // dataset against a positive rowCount — silent, undiagnosable data loss.
    // Throw loudly so the drift surfaces (and `recomputeDatasetCounts` repairs).
    if (dataset.chunkCount == null) {
      throw new DatasetChunkCountMissingError(datasetId);
    }

    const storage = await getDatasetStorage(projectId);

    const count = dataset.rowCount ?? 0;

    // M2: a single-row `entrySelection` reads ONLY the chunk that holds the row
    // (via `chunkOffsets`) — the same short-circuit the PG path gets from
    // skip/take — so it's O(1 chunk), not O(dataset).
    if (entrySelection !== "all") {
      const record = await selectS3JsonlRecordViaOffsets({
        dataset,
        projectId,
        storage,
        entrySelection,
      });
      if (record !== null) {
        return {
          ...dataset,
          count,
          datasetRecords: [record],
          truncated: false,
        };
      }
      // `record === null`: no short-circuit possible (missing/legacy offsets).
      // This rare defensive path reads the whole dataset to honour
      // last/random/N correctly, then selects the single row — an UNBOUNDED read
      // even for a single-row selection, so guard it on `sizeBytes` (the export
      // path below guards the same way) rather than OOM on a large legacy dataset.
      assertDatasetReadableInHeap(dataset);
      const rows = await storage.readChunks({
        projectId,
        datasetId,
        chunkCount: dataset.chunkCount,
      });
      const allRecords = rows.map((line) => adaptS3JsonlRecord(line, dataset));
      const selected = selectRecords(allRecords, entrySelection);
      const { truncatedRecords, truncated } = processBatchedRecords({
        records: selected,
        limitMb,
      });
      return {
        ...dataset,
        count: dataset.rowCount ?? allRecords.length,
        datasetRecords: truncatedRecords,
        truncated,
      };
    }

    // I-MEM: a full export (`limitMb: null`) would materialize the whole dataset
    // in heap. The bounded reads below cap at the byte budget; an unbounded
    // export can't, so guard it on the PG-authoritative size and reject a
    // multi-GB download with a clear, typed error instead of OOMing the pod.
    // (True streaming export is the reads-at-scale fast-follow epic.)
    if (limitMb === null) {
      assertDatasetReadableInHeap(dataset);
    }

    // "all": read chunks ONE AT A TIME (I-MEM), accumulating rows until the
    // `limitMb` byte budget is reached, then STOP — never reading the remaining
    // chunks. `count` stays PG-authoritative (it is NOT the number of rows
    // actually read). Equivalent to the prior read-all-then-truncate, minus the
    // unbounded read.
    const chunkCount = dataset.chunkCount ?? 0;
    const accumulated: DatasetRecord[] = [];
    let totalSize = 0;
    let truncated = false;
    for (let index = 0; index < chunkCount; index++) {
      const rows = await storage.readChunk({ projectId, datasetId, index });
      const records = rows.map((line) => adaptS3JsonlRecord(line, dataset));
      const result = processBatchedRecords({
        records,
        limitMb,
        totalSize,
      });
      accumulated.push(...result.truncatedRecords);
      totalSize = result.totalSize;
      if (result.truncated) {
        truncated = true;
        break;
      }
    }

    return {
      ...dataset,
      count,
      datasetRecords: accumulated,
      truncated,
    };
  }

  if (dataset.useS3) {
    let records: any[] = [];
    let truncated = false;
    let totalSize = 0;
    let currentPage = 0;

    try {
      const { records: recordsFromStorage } = await storageService.getObject(
        projectId,
        datasetId,
      );
      records = recordsFromStorage;

      do {
        const batch = records.slice(
          currentPage * BATCH_SIZE,
          (currentPage + 1) * BATCH_SIZE,
        );

        if (batch.length === 0) break;

        const {
          truncatedRecords: processedRecords,
          truncated: batchTruncated,
          totalSize: newTotalSize,
        } = processBatchedRecords({ records: batch, limitMb, totalSize });

        truncatedDatasetRecords.push(...processedRecords);
        truncated = batchTruncated;
        totalSize = newTotalSize;

        if (batch.length < BATCH_SIZE) break;
        currentPage++;
      } while (!truncated);

      return {
        ...dataset,
        count: records.length,
        datasetRecords: truncatedDatasetRecords,
        truncated,
      };
    } catch (error) {
      captureException(toError(error));
      throw error;
    }
  } else {
    const count = await prisma.datasetRecord.count({
      where: { datasetId, projectId },
    });

    if (
      entrySelection === "first" ||
      entrySelection === "random" ||
      entrySelection === "last" ||
      typeof entrySelection === "number"
    ) {
      let skip = 0;

      if (entrySelection === "first") {
        skip = 0;
      } else if (entrySelection === "last") {
        skip = Math.max(count - 1, 0);
      } else if (entrySelection === "random") {
        skip = Math.floor(Math.random() * count);
      } else if (typeof entrySelection === "number") {
        skip = Math.max(0, Math.min(entrySelection, count - 1));
      }

      return {
        ...dataset,
        count,
        datasetRecords: await prisma.datasetRecord.findMany({
          where: { datasetId, projectId },
          orderBy: { createdAt: "asc" },
          take: 1,
          skip,
        }),
      };
    }

    const truncatedDatasetRecords: DatasetRecord[] = [];
    let truncated = false;
    let totalSize = 0;
    let currentPage = 0;
    const BATCH_SIZE = 500;

    // Fetch records in batches
    do {
      const records = await prisma.datasetRecord.findMany({
        where: { datasetId, projectId },
        orderBy: { createdAt: "asc" },
        take: BATCH_SIZE,
        skip: currentPage * BATCH_SIZE,
      });

      if (records.length === 0) break;

      const {
        truncatedRecords: processedRecords,
        truncated: batchTruncated,
        totalSize: newTotalSize,
      } = processBatchedRecords({ records, limitMb, totalSize });

      truncatedDatasetRecords.push(...processedRecords);
      truncated = batchTruncated;
      totalSize = newTotalSize;

      if (records.length < BATCH_SIZE) break;
      currentPage++;
    } while (!truncated);

    return {
      ...dataset,
      datasetRecords: truncatedDatasetRecords,
      truncated,
      count,
    };
  }
};
