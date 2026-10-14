/**
 * The previous release's single-file datasets (`useS3` on the postgres layout): one JSON array,
 * read whole and rewritten whole under the dataset's lock, with `s3RecordCount` kept beside it
 * as that release kept it. Owner's ruling: served in place, never migrated.
 */
import {
  DatasetTooLargeToSearchError,
  datasetRecordSchema,
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
} from "@langwatch/dataset-contract";
import { Temporal, nowInstant, toDate } from "@langwatch/time";

import type { DatasetContent } from "../app/dataset.app.ts";
import type { DatasetContentRepository } from "../repositories/dataset-content.repository.ts";
import type { DatasetSingleFileRepository } from "../repositories/dataset-single-file.repository.ts";
import {
  matchesDatasetSearch,
  refuseSearchScan,
  type DatasetSearchCaps,
} from "../rules/dataset-search.rules.ts";
import {
  limitDatasetRecordsByBytes,
  sanitizedEntry,
  selectDatasetRecords,
} from "../rules/dataset-selection.rules.ts";
import {
  appendSingleFileRecords,
  parseSingleFileRecords,
  removeSingleFileRecords,
  storedRecordTimestampsSchema,
  upsertSingleFileRecord,
  type SingleFileRecord,
} from "../rules/dataset-single-file.rules.ts";

/** How many records the head preview shows, as the previous release did. */
const HEAD_RECORDS = 5;

type DatasetKey = { datasetId: string; projectId: string };

/** The fields a write needs from either a dataset or its stored row. */
type DatasetRef = Pick<Dataset, "id" | "projectId">;

export class DatasetSingleFileService implements Omit<
  DatasetContent,
  "copyDataset" | "updateColumns"
> {
  static create(options: {
    files: DatasetSingleFileRepository;
    datasets: DatasetContentRepository;
    generateId: () => string;
  }): DatasetSingleFileService {
    return new DatasetSingleFileService(options.files, options.datasets, options.generateId);
  }

  private constructor(
    private readonly files: DatasetSingleFileRepository,
    private readonly datasets: DatasetContentRepository,
    private readonly generateId: () => string,
  ) {}

  async listRecords(input: {
    dataset: Dataset;
    input: DatasetPageInput;
  }): Promise<DatasetRecordPage> {
    const records = await this.readRecords(input.dataset);
    return pageOf({ records, page: input.input.page ?? 1, limit: input.input.limit ?? 50 });
  }

  async getDatasetPage(input: { dataset: Dataset; input: DatasetPageInput }): Promise<DatasetPage> {
    const { dataset } = input;
    const page = await this.listRecords(input);
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

  async searchRecords(input: {
    dataset: Dataset;
    projectId: string;
    page: number;
    limit: number;
    search: string;
    caps: DatasetSearchCaps;
  }): Promise<DatasetRecordPage> {
    const records = await this.readRecords(input.dataset, input.caps.maxBytes);
    refuseSearchScan(records.length, 0, input.caps);
    const matches = records.filter((record) =>
      matchesDatasetSearch({ entry: record.entry, search: input.search }),
    );
    return pageOf({ records: matches, page: input.page, limit: input.limit });
  }

  async getDatasetWithRecords(input: {
    dataset: Dataset;
    projectId: string;
    entrySelection: DatasetEntrySelection;
    limitBytes: number;
  }): Promise<DatasetWithRecords> {
    const records = await this.readRecords(input.dataset);
    const selected = selectDatasetRecords(records, input.entrySelection);
    const bounded = limitDatasetRecordsByBytes(selected, input.limitBytes);
    return {
      dataset: input.dataset,
      records: bounded.records,
      truncated: bounded.truncated,
      totalRows: selected.length,
    };
  }

  async getDatasetHead(input: { dataset: Dataset }): Promise<DatasetHead> {
    const records = await this.readRecords(input.dataset);
    return {
      dataset: input.dataset,
      records: records.slice(0, HEAD_RECORDS),
      total: records.length,
    };
  }

  async findEntries(input: {
    dataset: Dataset;
    projectId: string;
    recordIds: readonly string[];
  }): Promise<Record<string, unknown>[]> {
    const wanted = new Set(input.recordIds);
    const stored = await this.readStored(keyOf(input.dataset));
    return stored
      .filter((record) => record.id !== undefined && wanted.has(record.id))
      .map((record) => record.entry);
  }

  /** Every entry in stored order, for a copy into another dataset. */
  async findAllEntries(input: { dataset: Dataset }): Promise<Record<string, unknown>[]> {
    const stored = await this.readStored(keyOf(input.dataset));
    return stored.map((record) => record.entry);
  }

  async upsertRecord(input: {
    dataset: Dataset;
    input: UpdateDatasetRecordInput & { recordId: string };
  }): Promise<DatasetRecordMutationResult> {
    const { dataset } = input;
    const entry = sanitizedEntry(input.input.updatedRecord);
    const created = await this.rewrite(dataset, (records, now) => {
      const result = upsertSingleFileRecord({
        ...keyOf(dataset),
        records,
        recordId: input.input.recordId,
        entry,
        now,
      });
      return { records: result.records, answer: result.created };
    });
    return {
      record: this.toDatasetRecord({ id: input.input.recordId, entry }, dataset),
      created,
    };
  }

  async batchCreateRecords(input: {
    dataset: Dataset;
    input: CreateDatasetRecordsInput;
  }): Promise<DatasetRecord[]> {
    const { dataset } = input;
    const added = input.input.entries.map(({ id, ...entry }) => ({
      id: id ?? this.generateId(),
      entry,
    }));
    await this.appendRecords({ dataset, records: added });
    return added.map((record) =>
      this.toDatasetRecord({ id: record.id, entry: sanitizedEntry(record.entry) }, dataset),
    );
  }

  /** Records appended after the stored ones, as the previous release appended them. */
  async appendRecords(input: {
    dataset: DatasetRef;
    records: readonly { id: string; entry: Record<string, unknown> }[];
  }): Promise<void> {
    const { dataset } = input;
    const added = input.records.map((record) => ({
      id: record.id,
      entry: sanitizedEntry(record.entry),
    }));
    await this.rewrite(dataset, (records, now) => ({
      records: appendSingleFileRecords({ ...keyOf(dataset), records, added, now }),
      answer: undefined,
    }));
  }

  async deleteRecords(input: {
    dataset: Dataset;
    input: DeleteDatasetRecordsInput;
  }): Promise<{ count: number }> {
    const count = await this.rewrite(input.dataset, (records) => {
      const result = removeSingleFileRecords({ records, recordIds: input.input.recordIds });
      return { records: result.records, answer: result.deleted };
    });
    return { count };
  }

  /**
   * Read, change and write the whole file under the dataset's lock. The count is recorded
   * first: a failed count update leaves the file untouched, and a failed file write rolls
   * the count back with the lock's transaction.
   */
  private rewrite<T>(
    dataset: DatasetRef,
    change: (
      records: SingleFileRecord[],
      now: string,
    ) => { records: SingleFileRecord[]; answer: T },
  ): Promise<T> {
    const key = keyOf(dataset);
    return this.datasets.withDatasetLock(dataset.id, async (locked) => {
      const changed = change(await this.readStored(key), nowInstant().toString());
      await locked.update({
        id: dataset.id,
        projectId: dataset.projectId,
        data: { s3RecordCount: changed.records.length },
      });
      await this.files.putSingleFile({ ...key, text: JSON.stringify(changed.records) });
      return changed.answer;
    });
  }

  /** Records shown to a caller; one stored without an id is given one, written once. */
  private async readRecords(dataset: Dataset, maxBytes?: number): Promise<DatasetRecord[]> {
    let stored = await this.readStored(keyOf(dataset), maxBytes);
    if (stored.some((record) => record.id === undefined)) {
      stored = await this.rewrite(dataset, (records) => {
        const identified = records.map((record) => ({
          ...record,
          id: record.id ?? this.generateId(),
        }));
        return { records: identified, answer: identified };
      });
    }
    return stored.map((record) => this.toDatasetRecord(record, dataset));
  }

  /** A missing file reads as an empty dataset, as the previous release read it. */
  private async readStored(key: DatasetKey, maxBytes?: number): Promise<SingleFileRecord[]> {
    const file = await this.files.getSingleFile({ ...key, maxBytes });
    if (file.outcome === "missing") return [];
    if (file.outcome === "too_large") {
      throw new DatasetTooLargeToSearchError({
        sizeBytes: file.sizeBytes,
        maxBytes: maxBytes ?? 0,
      });
    }
    const parsed = parseSingleFileRecords(file.text);
    if (parsed.outcome === "unreadable") {
      throw new Error(`Single-file dataset ${key.datasetId} is not a JSON array of records`);
    }
    return parsed.records;
  }

  /** The record's own stored timestamps when it has them, else the dataset's. */
  private toDatasetRecord(
    record: { id?: string | undefined; entry: Record<string, unknown>; [field: string]: unknown },
    dataset: Dataset,
  ): DatasetRecord {
    const stored = storedRecordTimestampsSchema.safeParse(record);
    return datasetRecordSchema.parse({
      id: record.id,
      entry: record.entry,
      datasetId: dataset.id,
      projectId: dataset.projectId,
      createdAt: stored.success
        ? toDate(Temporal.Instant.from(stored.data.createdAt))
        : dataset.createdAt,
      updatedAt: stored.success
        ? toDate(Temporal.Instant.from(stored.data.updatedAt))
        : dataset.updatedAt,
    });
  }
}

function keyOf(dataset: DatasetRef): DatasetKey {
  return { datasetId: dataset.id, projectId: dataset.projectId };
}

function pageOf(input: {
  records: DatasetRecord[];
  page: number;
  limit: number;
}): DatasetRecordPage {
  const { records, page, limit } = input;
  const total = records.length;
  return {
    data: records.slice((page - 1) * limit, page * limit),
    pagination: { page, limit, total, totalPages: total === 0 ? 0 : Math.ceil(total / limit) },
  };
}
