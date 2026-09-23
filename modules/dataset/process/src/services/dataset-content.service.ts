import {
  datasetRecordSchema,
  datasetSchema,
  type CreateDatasetRecordsInput,
  type Dataset,
  type DatasetEntrySelection,
  type DatasetHead,
  type DatasetPage,
  type DatasetPageInput,
  type DatasetRecord,
  type DatasetRecordMutationResult,
  type DatasetRecordPage,
  type DatasetWithRecords,
  type DeleteDatasetRecordsInput,
  type UpdateDatasetRecordInput,
  DatasetChunkCountMissingError,
  DatasetNotReadyError,
  DatasetTooLargeToSearchError,
} from "@langwatch/dataset-contract";
import { generate } from "@langwatch/ksuid";

import type { DatasetContent, DatasetStorageResolver } from "../app/dataset.app.ts";

/**
 * The app's KSUID resource for a chunk-line row (`KSUID_RESOURCES.RECORD`).
 * The literal, not the constant table: `record_` is the prefix every reader
 * of the s3_jsonl layout already expects.
 */
const RECORD_KSUID_RESOURCE = "record";
import type { DatasetContentRepository } from "../repositories/dataset-content.repository.ts";
import type { ChunkOffset } from "../rules/dataset-chunking.rules.ts";
import { DatasetChunkService } from "../services/dataset-chunk.service.ts";
import {
  DATASET_SEARCH_MAX_BYTES,
  DATASET_SEARCH_MAX_ROWS,
  matchesDatasetSearch,
  measureRowsBytes,
} from "./dataset-search.ts";

/** Object-backed Dataset content; all storage selection is injected at boot. */
export class DatasetContentAdapter implements DatasetContent {
  private readonly chunks: DatasetChunkService;

  private constructor(
    private readonly datasets: DatasetContentRepository,
    private readonly storageResolver: DatasetStorageResolver,
  ) {
    this.chunks = DatasetChunkService.create({ datasets });
  }

  static create(options: {
    datasets: DatasetContentRepository;
    storageResolver: DatasetStorageResolver;
  }): DatasetContentAdapter {
    return new DatasetContentAdapter(options.datasets, options.storageResolver);
  }

  async listRecords({
    dataset,
    input,
  }: {
    dataset: Dataset;
    input: DatasetPageInput;
  }): Promise<DatasetRecordPage> {
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

  async searchRecords(input: {
    dataset: Dataset;
    projectId: string;
    page: number;
    limit: number;
    search: string;
  }): Promise<DatasetRecordPage> {
    const { dataset } = input;
    this.assertReady(dataset);
    if ((dataset.rowCount ?? 0) > DATASET_SEARCH_MAX_ROWS) {
      throw new DatasetTooLargeToSearchError({
        rowCount: dataset.rowCount ?? 0,
        maxRows: DATASET_SEARCH_MAX_ROWS,
      });
    }
    if (dataset.sizeBytes !== null && dataset.sizeBytes > BigInt(DATASET_SEARCH_MAX_BYTES)) {
      throw new DatasetTooLargeToSearchError({
        sizeBytes: Number(dataset.sizeBytes),
        maxBytes: DATASET_SEARCH_MAX_BYTES,
      });
    }

    const storage = await this.storageResolver.forProject(input.projectId);
    const offsets = readSearchOffsets(dataset);
    const start = (input.page - 1) * input.limit;
    const end = start + input.limit;
    const records: DatasetRecord[] = [];
    let matches = 0;
    let rowsRead = 0;
    let recordedBytes = 0;
    let measuredBytes = 0;

    for (const offset of offsets) {
      refuseSearchScan(rowsRead, Math.max(measuredBytes, recordedBytes + (offset.byteSize ?? 0)));
      const rows = await storage.readChunk({
        projectId: input.projectId,
        datasetId: dataset.id,
        index: offset.index,
      });
      rowsRead += rows.length;
      recordedBytes += offset.byteSize ?? 0;
      measuredBytes += measureRowsBytes(rows);
      refuseSearchScan(rowsRead, Math.max(measuredBytes, recordedBytes));
      for (const row of rows) {
        const record = toDatasetRecord(row, dataset);
        if (!matchesDatasetSearch({ entry: record.entry, search: input.search })) continue;
        if (matches >= start && matches < end) records.push(record);
        matches++;
      }
    }

    return {
      data: records,
      pagination: {
        page: input.page,
        limit: input.limit,
        total: matches,
        totalPages: matches === 0 ? 0 : Math.ceil(matches / input.limit),
      },
    };
  }

  async getDatasetPage({
    dataset,
    input,
  }: {
    dataset: Dataset;
    input: DatasetPageInput;
  }): Promise<DatasetPage> {
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
  }): Promise<DatasetWithRecords> {
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

  async getDatasetHead({ dataset }: { dataset: Dataset }): Promise<DatasetHead> {
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
  }): Promise<DatasetRecordMutationResult> {
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
  }): Promise<DatasetRecord[]> {
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

  async deleteRecords({
    dataset,
    input,
  }: {
    dataset: Dataset;
    input: DeleteDatasetRecordsInput;
  }): Promise<{ count: number }> {
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
  }): Promise<Dataset> {
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
  if (!value.every(isChunkOffset)) return [];
  return value.map((offset) => ({ ...offset, byteSize: offset.byteSize ?? 0 }));
}

function readSearchOffsets(dataset: Dataset): { index: number; byteSize: number | null }[] {
  const value = dataset.chunkOffsets;
  if (Array.isArray(value) && value.length > 0 && value.every(isSearchOffset)) {
    return value
      .map((offset) => ({
        index: offset.index,
        byteSize:
          typeof offset.byteSize === "number" &&
          Number.isFinite(offset.byteSize) &&
          offset.byteSize >= 0
            ? offset.byteSize
            : null,
      }))
      .toSorted((left, right) => left.index - right.index);
  }
  if (dataset.chunkCount === null) throw new DatasetChunkCountMissingError(dataset.id);
  return Array.from({ length: dataset.chunkCount }, (_, index) => ({
    index,
    byteSize: null,
  }));
}

function isSearchOffset(value: unknown): value is {
  index: number;
  startRow: number;
  endRow: number;
  byteSize?: number;
} {
  if (typeof value !== "object" || value === null) return false;
  const offset = value as Record<string, unknown>;
  return (
    typeof offset.index === "number" &&
    typeof offset.startRow === "number" &&
    typeof offset.endRow === "number"
  );
}

function refuseSearchScan(rowsRead: number, bytesRead: number): void {
  if (rowsRead > DATASET_SEARCH_MAX_ROWS) {
    throw new DatasetTooLargeToSearchError({
      rowCount: rowsRead,
      maxRows: DATASET_SEARCH_MAX_ROWS,
    });
  }
  if (bytesRead > DATASET_SEARCH_MAX_BYTES) {
    throw new DatasetTooLargeToSearchError({
      sizeBytes: bytesRead,
      maxBytes: DATASET_SEARCH_MAX_BYTES,
    });
  }
}

function isChunkOffset(value: unknown): value is Omit<ChunkOffset, "byteSize"> & {
  byteSize?: number;
} {
  if (typeof value !== "object" || value === null) return false;
  const offset = value as Record<string, unknown>;
  return (
    typeof offset.index === "number" &&
    typeof offset.startRow === "number" &&
    typeof offset.endRow === "number" &&
    (offset.byteSize === undefined || typeof offset.byteSize === "number")
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
    id: typeof value.id === "string" ? value.id : generate(RECORD_KSUID_RESOURCE).toString(),
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

  if (selection === "first") return [records[0]!];
  if (selection === "last") return [records[records.length - 1]!];
  if (selection === "random") return [records[Math.floor(Math.random() * records.length)]!];

  const index = Math.max(0, Math.min(selection, records.length - 1));
  return [records[index]!];
}
