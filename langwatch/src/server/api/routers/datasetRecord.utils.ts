import type { Dataset, DatasetRecord } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { captureException } from "~/utils/posthogErrorCapture";
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
      entry: entryWithoutId,
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
}: {
  datasetId: string;
  projectId: string;
  // Input records - IDs are optional (backend generates with nanoid)
  datasetRecords: DatasetRecordInput[];
}) => {
  const dataset = await prisma.dataset.findFirst({
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
        captureException(error);
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

    await prisma.dataset.update({
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

    return prisma.datasetRecord.createMany({
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

const pickSingleEntry = ({
  records,
  entrySelection,
}: {
  records: DatasetRecord[];
  entrySelection: "first" | "last" | "random" | "all" | number;
}) => {
  if (
    entrySelection !== "first" &&
    entrySelection !== "last" &&
    entrySelection !== "random" &&
    typeof entrySelection !== "number"
  ) {
    return null;
  }

  if (records.length === 0) {
    return [];
  }

  let index = 0;

  if (entrySelection === "last") {
    index = Math.max(records.length - 1, 0);
  } else if (entrySelection === "random") {
    index = Math.floor(Math.random() * records.length);
  } else if (typeof entrySelection === "number") {
    index = Math.max(0, Math.min(entrySelection, records.length - 1));
  }

  return [records[index] as DatasetRecord];
};

export const getFullDataset = async ({
  datasetId,
  projectId,
  entrySelection = "all",
  limitMb = 5,
}: {
  datasetId: string;
  projectId: string;
  entrySelection?: "first" | "last" | "random" | "all" | number;
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

      const selectedRecord = pickSingleEntry({
        records,
        entrySelection,
      });

      if (selectedRecord) {
        return {
          ...dataset,
          count: records.length,
          datasetRecords: selectedRecord,
        };
      }

      return {
        ...dataset,
        count: records.length,
        datasetRecords: truncatedDatasetRecords,
        truncated,
      };
    } catch (error) {
      captureException(error);
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
