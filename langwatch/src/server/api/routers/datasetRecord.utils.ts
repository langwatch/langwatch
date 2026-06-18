import type { Dataset, DatasetRecord, Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import { getDatasetStorage } from "../../datasets/dataset-storage";
import { DatasetNotReadyError } from "../../datasets/errors";
import { stripNullBytes } from "../../datasets/sanitize";
import type { DatasetRecordInput } from "../../datasets/types";
import { prisma } from "../../db";
import { StorageService } from "../../storage";

const storageService = new StorageService();

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

/**
 * Read the head (first up-to-5 rows) of an s3_jsonl dataset for the preview,
 * gated on `status='ready'` (ADR-032 Decision 6 / I-READY). Reads only the
 * first chunk — never the whole dataset — and reports the PG-authoritative
 * count. Extracted from the `getHead` tRPC procedure so the s3_jsonl read path
 * is unit-testable at its boundaries (prisma already resolved the row).
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
  // Read just the first chunk for the preview — never the whole dataset.
  const rows = await storage.readChunks({
    projectId,
    datasetId: dataset.id,
    chunkCount: Math.min(1, dataset.chunkCount ?? 0),
  });

  return {
    records: rows.slice(0, 5).map((line) => adaptS3JsonlRecord(line, dataset)),
    total: dataset.rowCount ?? rows.length,
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

    const storage = await getDatasetStorage(projectId);
    const rows = await storage.readChunks({
      projectId,
      datasetId,
      chunkCount: dataset.chunkCount ?? 0,
    });

    const allRecords = rows.map((line) => adaptS3JsonlRecord(line, dataset));
    const selected = selectRecords(allRecords, entrySelection);

    // Same 5 MB truncation the PG path applies (reads-at-scale is the
    // fast-follow epic; in-memory + truncation is acceptable for now).
    const { truncatedRecords, truncated } = processBatchedRecords({
      records: selected,
      limitMb,
    });

    return {
      ...dataset,
      // PG-authoritative count; falls back to the read length only if rowCount
      // was never written (defensive — normalize always sets it).
      count: dataset.rowCount ?? allRecords.length,
      datasetRecords: truncatedRecords,
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
