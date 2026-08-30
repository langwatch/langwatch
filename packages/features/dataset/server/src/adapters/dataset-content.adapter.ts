import {
  datasetRecordSchema,
  datasetSchema,
  type CreateDatasetRecordsInput,
  type Dataset,
  type DatasetEntrySelection,
  type DatasetPageInput,
  type DatasetRecord,
  type DeleteDatasetRecordsInput,
  type UpdateDatasetRecordInput,
} from "@langwatch/dataset-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { DatasetContentPort } from "../ports/dataset.port";
import type { DatasetStorageResolver } from "../ports/dataset-storage.port";
import { DatasetContentRepository } from "../repositories/prisma/dataset-content.repository";
import { DatasetRecordContentRepository } from "../repositories/prisma/dataset-record-content.repository";
import type { ChunkOffset } from "../services/dataset-chunking";
import { DatasetChunkService } from "../services/dataset-chunk.service";
import { DatasetChunkCountMissingError, DatasetNotReadyError } from "../services/errors";

/** Object-backed Dataset content; all storage selection is injected at boot. */
export class DatasetContentAdapter extends DatasetContentPort {
  private readonly chunks: DatasetChunkService;

  private constructor(
    private readonly database: PrismaClient,
    private readonly datasets: DatasetContentRepository,
    private readonly records: DatasetRecordContentRepository,
    private readonly storageResolver: DatasetStorageResolver,
  ) {
    super();
    this.chunks = DatasetChunkService.create({ datasets });
  }

  static create(options: {
    database: PrismaClient;
    datasets: DatasetContentRepository;
    records: DatasetRecordContentRepository;
    storageResolver: DatasetStorageResolver;
  }): DatasetContentAdapter {
    return new DatasetContentAdapter(
      options.database,
      options.datasets,
      options.records,
      options.storageResolver,
    );
  }

  async listRecords({ dataset, input }: { dataset: Dataset; input: DatasetPageInput }) {
    this.assertReady(dataset);
    const total = dataset.rowCount ?? 0;
    const limit = input.limit ?? 50;
    const page = input.page ?? 1;
    const storage = await this.storageResolver.forProject(input.projectId);
    const offsets = readChunkOffsets(dataset.chunkOffsets);
    const start = (page - 1) * limit;
    const end = start + limit;
    const records: DatasetRecord[] = [];
    if (!dataset.chunkCount) {
      throw new DatasetChunkCountMissingError(dataset.id);
    }
    const selected =
      offsets.length > 0
        ? offsets.filter((offset) => offset.startRow < end && offset.endRow > start)
        : Array.from({ length: dataset.chunkCount }, (_, index) => ({
            index,
            startRow: 0,
            endRow: Number.MAX_SAFE_INTEGER,
            byteSize: 0,
          }));

    for (const offset of selected) {
      const chunk = await storage.readChunk({
        projectId: input.projectId,
        datasetId: dataset.id,
        index: offset.index,
      });
      chunk.forEach((line, index) => {
        const globalIndex = offset.startRow + index;
        if (globalIndex >= start && globalIndex < end) {
          records.push(toDatasetRecord(line, dataset));
        }
      });
    }

    return {
      data: records,
      pagination: {
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    };
  }

  async getDatasetPage({ dataset, input }: { dataset: Dataset; input: DatasetPageInput }) {
    const page = await this.listRecords({ dataset, input });
    return {
      id: dataset.id,
      name: dataset.name,
      columnTypes: dataset.columnTypes,
      datasetRecords: page.data,
      count: page.pagination.total,
      page: page.pagination.page,
      limit: page.pagination.limit,
      totalPages: page.pagination.totalPages,
    };
  }

  async getDatasetWithRecords({
    dataset,
    projectId,
    entrySelection,
    limitMb,
  }: {
    dataset: Dataset;
    projectId: string;
    entrySelection: DatasetEntrySelection;
    limitMb: number | null;
  }) {
    this.assertReady(dataset);
    if (!dataset.chunkCount) {
      throw new DatasetChunkCountMissingError(dataset.id);
    }
    const storage = await this.storageResolver.forProject(projectId);
    const lines = await storage.readChunks({
      projectId,
      datasetId: dataset.id,
      chunkCount: dataset.chunkCount,
    });
    const records = lines.map((line) => toDatasetRecord(line, dataset));
    const selected = selectRecords(records, entrySelection);
    const bounded =
      limitMb === null
        ? selected
        : selected.filter((record) => JSON.stringify(record.entry).length <= limitMb * 1024 * 1024);
    return {
      dataset,
      records: bounded,
      truncated: bounded.length !== selected.length,
    };
  }

  async getDatasetHead({ dataset }: { dataset: Dataset }) {
    const result = await this.listRecords({
      dataset,
      input: {
        slugOrId: dataset.id,
        projectId: dataset.projectId,
        page: 1,
        limit: 5,
      },
    });
    return {
      dataset,
      records: result.data,
      total: result.pagination.total,
    };
  }

  async upsertRecord({
    dataset,
    input,
  }: {
    dataset: Dataset;
    input: UpdateDatasetRecordInput & { recordId: string };
  }) {
    const storage = await this.storageResolver.forProject(input.projectId);
    const result = await this.chunks.editRecord({
      dataset,
      projectId: input.projectId,
      recordId: input.recordId,
      entry: input.updatedRecord,
      storage,
    });
    return {
      record: toDatasetRecord({ id: input.recordId, entry: input.updatedRecord }, dataset),
      created: !result.updated,
    };
  }

  async batchCreateRecords({
    dataset,
    input,
  }: {
    dataset: Dataset;
    input: CreateDatasetRecordsInput;
  }) {
    const entries = input.entries.map((entry) => ({ ...entry }));
    const storage = await this.storageResolver.forProject(input.projectId);
    await this.chunks.append({
      dataset,
      projectId: input.projectId,
      entries,
      forcedIds: entries.map((entry) => entry.id),
      storage,
    });
    return entries.map((entry) => toDatasetRecord({ id: entry.id, entry }, dataset));
  }

  async deleteRecords({ dataset, input }: { dataset: Dataset; input: DeleteDatasetRecordsInput }) {
    const result = await this.chunks.deleteRecords({
      dataset,
      projectId: input.projectId,
      recordIds: input.recordIds,
      storage: await this.storageResolver.forProject(input.projectId),
    });
    return { count: result.deleted };
  }

  async copyDataset({
    source,
    sourceProjectId,
    target,
    targetProjectId,
  }: {
    source: Dataset;
    sourceProjectId: string;
    target: Dataset;
    targetProjectId: string;
  }): Promise<void> {
    this.assertReady(source);
    if (!source.chunkCount) {
      throw new DatasetChunkCountMissingError(source.id);
    }
    const sourceStorage = await this.storageResolver.forProject(sourceProjectId);
    const targetStorage = await this.storageResolver.forProject(targetProjectId);
    const rows = await sourceStorage.readChunks({
      projectId: sourceProjectId,
      datasetId: source.id,
      chunkCount: source.chunkCount,
    });
    const entries = rows.map(toStoredEntry);
    const chunks = await targetStorage.writeChunks({
      projectId: targetProjectId,
      datasetId: target.id,
      records: entries,
    });
    await this.datasets.update({
      id: target.id,
      projectId: targetProjectId,
      data: {
        contentLayout: "s3_jsonl",
        status: "ready",
        rowCount: entries.length,
        chunkCount: chunks.length,
        sizeBytes: BigInt(chunks.reduce((total, chunk) => total + chunk.byteSize, 0)),
        chunkOffsets: chunks.map((chunk) => ({
          index: chunk.index,
          startRow: chunk.startRow,
          endRow: chunk.endRow,
          byteSize: chunk.byteSize,
        })),
      },
    });
  }

  async updateColumns({
    dataset,
    projectId,
    name,
    slug,
    columnTypes,
  }: {
    dataset: Dataset;
    projectId: string;
    name: string;
    slug: string;
    columnTypes: Dataset["columnTypes"];
  }) {
    const updated = await this.chunks.migrateColumns({
      dataset,
      projectId,
      oldColumnTypes: dataset.columnTypes,
      newColumnTypes: columnTypes,
      name,
      slug,
      storage: await this.storageResolver.forProject(projectId),
    });
    return datasetSchema.parse(updated);
  }

  private assertReady(dataset: Dataset): void {
    if (dataset.status !== "ready") {
      throw new DatasetNotReadyError({
        status: dataset.status,
        statusError: dataset.statusError,
      });
    }
  }
}

function readChunkOffsets(value: unknown): ChunkOffset[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isChunkOffset);
}

function isChunkOffset(value: unknown): value is ChunkOffset {
  if (typeof value !== "object" || value === null) return false;
  const offset = value as Record<string, unknown>;
  return (
    typeof offset.index === "number" &&
    typeof offset.startRow === "number" &&
    typeof offset.endRow === "number" &&
    typeof offset.byteSize === "number"
  );
}

function toStoredEntry(line: unknown): unknown {
  return typeof line === "object" && line !== null && "entry" in line
    ? (line as { entry: unknown }).entry
    : line;
}

function toDatasetRecord(line: unknown, dataset: Dataset): DatasetRecord {
  const value =
    typeof line === "object" && line !== null && "entry" in line
      ? (line as { id?: unknown; entry: unknown })
      : { entry: line };
  return datasetRecordSchema.parse({
    id: typeof value.id === "string" ? value.id : `record_${crypto.randomUUID()}`,
    entry: value.entry,
    datasetId: dataset.id,
    projectId: dataset.projectId,
    createdAt: dataset.createdAt,
    updatedAt: dataset.updatedAt,
  });
}

function selectRecords(
  records: DatasetRecord[],
  selection: DatasetEntrySelection,
): DatasetRecord[] {
  if (selection === "all") return records;
  if (records.length === 0) return [];
  const index =
    selection === "first"
      ? 0
      : selection === "last"
        ? records.length - 1
        : selection === "random"
          ? Math.floor(Math.random() * records.length)
          : Math.max(0, Math.min(selection, records.length - 1));
  return [records[index]!];
}
