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

import type { DatasetContent } from "../app/dataset.app.ts";

/**
 * The app's KSUID resource for a chunk-line row (`KSUID_RESOURCES.RECORD`).
 * The literal, not the constant table: `record_` is the prefix every reader
 * of the s3_jsonl layout already expects.
 */
const RECORD_KSUID_RESOURCE = "record";
import type { DatasetChunkRepository } from "../repositories/dataset-chunk.repository.ts";
import type { DatasetContentRepository } from "../repositories/dataset-content.repository.ts";
import type { ChunkOffset } from "../rules/dataset-chunking.rules.ts";
import { assertStoredRowWithinLimit } from "../rules/dataset-row-limits.rules.ts";
import {
  matchesDatasetSearch,
  measureRowsBytes,
  refuseSearchScan,
  type DatasetSearchCaps,
} from "../rules/dataset-search.rules.ts";
import {
  limitDatasetRecordsByBytes,
  selectDatasetRecords,
} from "../rules/dataset-selection.rules.ts";
import { DatasetChunkReadService } from "../services/dataset-chunk-read.service.ts";
import { StreamingChunkWriterService } from "../services/dataset-chunk-writer.service.ts";
import { DatasetChunkService } from "../services/dataset-chunk.service.ts";

/** Object-backed Dataset content; all storage selection is injected at boot. */
export class DatasetContentService implements DatasetContent {
  private readonly chunks: DatasetChunkService;

  private readonly reads = DatasetChunkReadService.create();

  private constructor(
    private readonly datasets: DatasetContentRepository,
    private readonly storage: DatasetChunkRepository,
  ) {
    this.chunks = DatasetChunkService.create({ datasets });
  }

  static create(options: {
    datasets: DatasetContentRepository;
    storage: DatasetChunkRepository;
  }): DatasetContentService {
    return new DatasetContentService(options.datasets, options.storage);
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
    const storage = this.storage;
    const offsets = readChunkOffsets(dataset.chunkOffsets);
    const start = (page - 1) * limit;
    const end = start + limit;
    const records: DatasetRecord[] = [];
    if (dataset.chunkCount === null) {
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
    caps: DatasetSearchCaps;
  }): Promise<DatasetRecordPage> {
    const { dataset, caps } = input;
    this.assertReady(dataset);
    if ((dataset.rowCount ?? 0) > caps.maxRows) {
      throw new DatasetTooLargeToSearchError({
        rowCount: dataset.rowCount ?? 0,
        maxRows: caps.maxRows,
      });
    }
    if (dataset.sizeBytes !== null && dataset.sizeBytes > BigInt(caps.maxBytes)) {
      throw new DatasetTooLargeToSearchError({
        sizeBytes: Number(dataset.sizeBytes),
        maxBytes: caps.maxBytes,
      });
    }

    const storage = this.storage;
    const offsets = readSearchOffsets(dataset);
    const start = (input.page - 1) * input.limit;
    const end = start + input.limit;
    const records: DatasetRecord[] = [];
    let matches = 0;
    let rowsRead = 0;
    let recordedBytes = 0;
    let measuredBytes = 0;

    for (const offset of offsets) {
      refuseSearchScan(
        rowsRead,
        Math.max(measuredBytes, recordedBytes + (offset.byteSize ?? 0)),
        caps,
      );
      const rows = await storage.readChunk({
        projectId: input.projectId,
        datasetId: dataset.id,
        index: offset.index,
      });
      rowsRead += rows.length;
      recordedBytes += offset.byteSize ?? 0;
      measuredBytes += measureRowsBytes(rows);
      refuseSearchScan(rowsRead, Math.max(measuredBytes, recordedBytes), caps);
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
    limitBytes,
  }: {
    dataset: Dataset;
    projectId: string;
    entrySelection: DatasetEntrySelection;
    limitBytes: number;
  }): Promise<DatasetWithRecords> {
    this.assertReady(dataset);
    if (dataset.chunkCount === null) {
      throw new DatasetChunkCountMissingError(dataset.id);
    }
    if (entrySelection === "all") {
      return this.reads.readWithinBudget({
        dataset,
        limitBytes,
        storage: this.storage,
        toRecord: (line) => toDatasetRecord(line, dataset),
      });
    }

    const lines = await this.storage.readChunks({
      projectId,
      datasetId: dataset.id,
      chunkCount: dataset.chunkCount,
    });
    const records = lines.map((line) => toDatasetRecord(line, dataset));
    const selected = selectDatasetRecords(records, entrySelection);
    const bounded = limitDatasetRecordsByBytes(selected, limitBytes);

    return {
      dataset,
      records: bounded.records,
      truncated: bounded.truncated,
      totalRows: selected.length,
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

  findEntries(input: {
    dataset: Dataset;
    projectId: string;
    recordIds: readonly string[];
  }): Promise<Record<string, unknown>[]> {
    return this.reads.findEntries({
      dataset: input.dataset,
      projectId: input.projectId,
      ids: input.recordIds,
      storage: this.storage,
    });
  }

  async upsertRecord({
    dataset,
    input,
  }: {
    dataset: Dataset;
    input: UpdateDatasetRecordInput & { recordId: string };
  }): Promise<DatasetRecordMutationResult> {
    assertStoredRowWithinLimit(input.updatedRecord);
    const storage = this.storage;
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
    const forcedIds = input.entries.map((entry) => entry.id);
    const entries = input.entries.map(({ id: _id, ...entry }) => entry);
    entries.forEach((entry) => assertStoredRowWithinLimit(entry));
    const storage = this.storage;
    await this.chunks.append({
      dataset,
      projectId: input.projectId,
      entries,
      forcedIds,
      storage,
    });
    return entries.map((entry, index) => toDatasetRecord({ id: forcedIds[index], entry }, dataset));
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
      storage: this.storage,
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
    if (source.chunkCount === null) {
      throw new DatasetChunkCountMissingError(source.id);
    }
    // One chunk in memory at a time, whatever the dataset's size.
    const writer = StreamingChunkWriterService.create({
      storage: this.storage,
      projectId: targetProjectId,
      datasetId: target.id,
    });
    for (let index = 0; index < source.chunkCount; index++) {
      const rows = await this.storage.readChunk({
        projectId: sourceProjectId,
        datasetId: source.id,
        index,
      });
      for (const row of rows) await writer.push(toStoredEntry(row));
    }
    const written = await writer.finalize();
    await this.datasets.update({
      id: target.id,
      projectId: targetProjectId,
      data: {
        contentLayout: "s3_jsonl",
        status: "ready",
        rowCount: written.rowCount,
        chunkCount: written.chunkCount,
        sizeBytes: BigInt(written.sizeBytes),
        chunkOffsets: written.chunkOffsets,
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
      storage: this.storage,
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
