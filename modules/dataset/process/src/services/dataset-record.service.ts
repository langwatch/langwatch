/**
 * Reading and writing a dataset's records: the inline Postgres rows, and the s3_jsonl content
 * port that answers for datasets whose rows live in object storage.
 */
import {
  DatasetRecordNotFoundError,
  DatasetTooLargeToSearchError,
  createDatasetRecordsInputSchema,
  datasetLookupInputSchema,
  datasetPageInputSchema,
  datasetWithRecordsInputSchema,
  deleteDatasetRecordsInputSchema,
  updateDatasetRecordInputSchema,
  type CreateDatasetRecordsInput,
  type Dataset,
  type DatasetEntrySelection,
  type DatasetHead,
  type DatasetLookupInput,
  type DatasetPage,
  type DatasetPageInput,
  type DatasetRecord,
  type DatasetRecordMutationResult,
  type DatasetRecordPage,
  type DatasetWithRecords,
  type DeleteDatasetRecordsInput,
  type UpdateDatasetRecordInput,
} from "@langwatch/dataset-contract";

import {
  isDatasetRecordNotFound,
  limitDatasetRecordsByBytes,
  sanitizedEntry,
  selectDatasetRecords,
} from "../rules/dataset-selection.rules.ts";
import type { DatasetRequestBoundsService } from "./dataset-request-bounds.service.ts";
import {
  DATASET_SEARCH_MAX_BYTES,
  DATASET_SEARCH_MAX_ROWS,
  DATASET_SEARCH_SCAN_BATCH,
  matchesDatasetSearch,
  normalizeDatasetSearch,
} from "./dataset-search.ts";
import type { DatasetServiceOptions } from "./dataset.service.ts";

type DatasetRecordServiceOptions = {
  options: DatasetServiceOptions;
  /** The owning service's own lookup, so a record read refuses a missing dataset alike. */
  getBySlugOrId: (input: DatasetLookupInput) => Promise<Dataset>;
  assertReady: (dataset: Dataset) => void;
  assertKnownColumns: (input: {
    datasetName: string;
    columns: string[];
    entries: readonly Record<string, unknown>[];
  }) => void;
  generateId: () => string;
  /** The tier-aware batch bound the writes refuse above. */
  requestBounds: DatasetRequestBoundsService;
};

export class DatasetRecordService {
  static create(deps: DatasetRecordServiceOptions): DatasetRecordService {
    return new DatasetRecordService(deps);
  }

  private constructor(private readonly deps: DatasetRecordServiceOptions) {}

  private get options(): DatasetServiceOptions {
    return this.deps.options;
  }

  private getBySlugOrId(input: DatasetLookupInput): Promise<Dataset> {
    return this.deps.getBySlugOrId(input);
  }

  private assertReady(dataset: Dataset): void {
    this.deps.assertReady(dataset);
  }

  private generateId(): string {
    return this.deps.generateId();
  }

  async listRecords(input: DatasetPageInput): Promise<DatasetRecordPage> {
    const parsed = datasetPageInputSchema.parse(input);
    const dataset = await this.getBySlugOrId({
      slugOrId: parsed.slugOrId,
      projectId: parsed.projectId,
    });
    this.assertReady(dataset);
    const search = normalizeDatasetSearch(parsed.search);
    if (search) {
      return this.searchRecords({ dataset, input: parsed, search });
    }
    if (dataset.contentLayout === "s3_jsonl" && this.options.content) {
      return this.options.content.listRecords({ dataset, input: parsed });
    }

    const result = await this.options.records.listAll({
      datasetId: dataset.id,
      projectId: parsed.projectId,
      page: parsed.page ?? 1,
      limit: parsed.limit ?? 50,
    });
    const page = parsed.page ?? 1;
    const limit = parsed.limit ?? 50;

    return {
      data: result.records,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: result.total === 0 ? 0 : Math.ceil(result.total / limit),
      },
    };
  }

  private async searchRecords({
    dataset,
    input,
    search,
  }: {
    dataset: Dataset;
    input: ReturnType<typeof datasetPageInputSchema.parse>;
    search: string;
  }): Promise<DatasetRecordPage> {
    const recordedRows = dataset.rowCount ?? 0;
    if (recordedRows > DATASET_SEARCH_MAX_ROWS) {
      throw new DatasetTooLargeToSearchError({
        rowCount: recordedRows,
        maxRows: DATASET_SEARCH_MAX_ROWS,
      });
    }
    if (dataset.sizeBytes !== null && dataset.sizeBytes > BigInt(DATASET_SEARCH_MAX_BYTES)) {
      throw new DatasetTooLargeToSearchError({
        sizeBytes: Number(dataset.sizeBytes),
        maxBytes: DATASET_SEARCH_MAX_BYTES,
      });
    }

    if (dataset.contentLayout === "s3_jsonl" && this.options.content) {
      return this.options.content.searchRecords({
        dataset,
        projectId: input.projectId,
        page: input.page,
        limit: input.limit,
        search,
      });
    }

    const storedRows = await this.options.records.count({
      datasetId: dataset.id,
      projectId: input.projectId,
    });
    if (storedRows > DATASET_SEARCH_MAX_ROWS) {
      throw new DatasetTooLargeToSearchError({
        rowCount: storedRows,
        maxRows: DATASET_SEARCH_MAX_ROWS,
      });
    }

    const page = input.page;
    const limit = input.limit;
    const windowStart = (page - 1) * limit;
    const windowEnd = windowStart + limit;
    const matches: DatasetRecord[] = [];
    let matched = 0;
    await this.scanPostgresRecords({
      dataset,
      projectId: input.projectId,
      collect: (record) => {
        if (!matchesDatasetSearch({ entry: record.entry, search })) return;
        if (matched >= windowStart && matched < windowEnd) matches.push(record);
        matched++;
      },
    });

    return {
      data: matches,
      pagination: {
        page,
        limit,
        total: matched,
        totalPages: matched === 0 ? 0 : Math.ceil(matched / limit),
      },
    };
  }

  private async scanPostgresRecords(input: {
    dataset: Dataset;
    projectId: string;
    collect: (record: DatasetRecord) => void;
  }): Promise<void> {
    let rowsRead = 0;
    let cursorId: string | undefined;
    while (rowsRead <= DATASET_SEARCH_MAX_ROWS) {
      const records = await this.options.records.findPage({
        datasetId: input.dataset.id,
        projectId: input.projectId,
        limit: DATASET_SEARCH_SCAN_BATCH,
        cursorId,
      });
      rowsRead += records.length;
      if (rowsRead > DATASET_SEARCH_MAX_ROWS) {
        throw new DatasetTooLargeToSearchError({
          rowCount: rowsRead,
          maxRows: DATASET_SEARCH_MAX_ROWS,
        });
      }
      records.forEach(input.collect);
      if (records.length < DATASET_SEARCH_SCAN_BATCH) return;
      cursorId = records.at(-1)?.id;
      if (!cursorId) return;
    }
  }

  async getDatasetPage(input: DatasetPageInput): Promise<DatasetPage> {
    const parsed = datasetPageInputSchema.parse(input);
    const dataset = await this.getBySlugOrId({
      slugOrId: parsed.slugOrId,
      projectId: parsed.projectId,
    });
    this.assertReady(dataset);
    if (dataset.contentLayout === "s3_jsonl" && this.options.content) {
      return this.options.content.getDatasetPage({ dataset, input: parsed });
    }

    const page = await this.options.records.listAll({
      datasetId: dataset.id,
      projectId: parsed.projectId,
      page: parsed.page ?? 1,
      limit: parsed.limit ?? 50,
    });

    return {
      id: dataset.id,
      name: dataset.name,
      columnTypes: dataset.columnTypes,
      datasetRecords: page.records,
      count: page.total,
      page: parsed.page ?? 1,
      limit: parsed.limit ?? 50,
      totalPages: page.total === 0 ? 0 : Math.ceil(page.total / (parsed.limit ?? 50)),
    };
  }

  async getDatasetWithRecords(
    input: DatasetLookupInput & {
      limitMb?: number | null;
      entrySelection?: DatasetEntrySelection;
    },
  ): Promise<DatasetWithRecords> {
    const parsed = datasetWithRecordsInputSchema.parse(input);
    const dataset = await this.getBySlugOrId({
      slugOrId: parsed.slugOrId,
      projectId: parsed.projectId,
    });
    if (dataset.contentLayout === "s3_jsonl" && this.options.content) {
      return this.options.content.getDatasetWithRecords({
        dataset,
        projectId: parsed.projectId,
        entrySelection: parsed.entrySelection,
        limitMb: parsed.limitMb ?? 5,
      });
    }

    const records: DatasetRecord[] = [];
    let page = 1;
    let hasMoreRecords = true;
    while (hasMoreRecords) {
      const result = await this.listRecords({
        slugOrId: parsed.slugOrId,
        projectId: parsed.projectId,
        page,
        limit: 200,
      });
      records.push(...result.data);
      const lastPage = result.data.length < 200;
      const readAllRecords = records.length >= result.pagination.total;
      hasMoreRecords = !lastPage && !readAllRecords;

      page += 1;
    }

    const selected = selectDatasetRecords(records, parsed.entrySelection);
    const limited = limitDatasetRecordsByBytes(selected, parsed.limitMb ?? 5);

    return { dataset, records: limited.records, truncated: limited.truncated };
  }

  async getDatasetHead(input: DatasetLookupInput): Promise<DatasetHead> {
    const parsed = datasetLookupInputSchema.parse(input);
    const dataset = await this.getBySlugOrId({
      slugOrId: parsed.slugOrId,
      projectId: parsed.projectId,
    });
    this.assertReady(dataset);
    if (dataset.contentLayout === "s3_jsonl" && this.options.content) {
      return this.options.content.getDatasetHead({ dataset });
    }

    const page = await this.listRecords({
      slugOrId: parsed.slugOrId,
      projectId: parsed.projectId,
      page: 1,
      limit: 5,
    });

    return { dataset, records: page.data, total: page.pagination.total };
  }

  async upsertRecord(
    input: UpdateDatasetRecordInput & { recordId: string },
  ): Promise<DatasetRecordMutationResult> {
    const parsed = updateDatasetRecordInputSchema.parse(input);
    const dataset = await this.getBySlugOrId({
      slugOrId: parsed.slugOrId,
      projectId: parsed.projectId,
    });
    this.assertReady(dataset);
    await this.options.attachments.assertAccepted({
      projectId: parsed.projectId,
      columnTypes: dataset.columnTypes,
      entries: [parsed.updatedRecord],
      findHeld: () => this.findHeldEntries(dataset, parsed.projectId, parsed.recordId),
    });
    if (dataset.contentLayout === "s3_jsonl" && this.options.content) {
      return this.options.content.upsertRecord({ dataset, input: parsed });
    }

    try {
      return {
        record: await this.options.records.update({
          id: parsed.recordId,
          datasetId: dataset.id,
          projectId: parsed.projectId,
          entry: sanitizedEntry(parsed.updatedRecord),
        }),
        created: false,
      };
    } catch (error) {
      if (!isDatasetRecordNotFound(error)) {
        throw error;
      }
    }

    const [record] = await this.options.records.createMany({
      datasetId: dataset.id,
      projectId: parsed.projectId,
      entries: [{ id: parsed.recordId, ...sanitizedEntry(parsed.updatedRecord) }],
    });
    if (!record) {
      throw new Error("Dataset record creation returned no record");
    }

    return { record, created: true };
  }

  private async findHeldEntries(
    dataset: Dataset,
    projectId: string,
    recordId: string,
  ): Promise<Record<string, unknown>[]> {
    if (dataset.contentLayout === "s3_jsonl" && this.options.content) {
      return this.options.content.findEntries({ dataset, projectId, recordIds: [recordId] });
    }
    const records = await this.options.records.findByIds({
      datasetId: dataset.id,
      projectId,
      ids: [recordId],
    });

    return records.map((record) => record.entry);
  }

  async batchCreateRecords(input: CreateDatasetRecordsInput): Promise<DatasetRecord[]> {
    const parsed = createDatasetRecordsInputSchema.parse(input);
    await this.deps.requestBounds.assertBatchSize(parsed.projectId, parsed.entries.length);
    const dataset = await this.getBySlugOrId({
      slugOrId: parsed.slugOrId,
      projectId: parsed.projectId,
    });
    this.assertReady(dataset);
    const columns = dataset.columnTypes.map((column) => column.name);
    this.deps.assertKnownColumns({
      datasetName: dataset.name,
      columns,
      entries: parsed.entries,
    });
    await this.options.attachments.assertAccepted({
      projectId: parsed.projectId,
      columnTypes: dataset.columnTypes,
      entries: parsed.entries,
    });
    if (dataset.contentLayout === "s3_jsonl" && this.options.content) {
      return this.options.content.batchCreateRecords({ dataset, input: parsed });
    }

    return this.options.records.createMany({
      datasetId: dataset.id,
      projectId: parsed.projectId,
      entries: parsed.entries.map((entry) => ({
        id: entry.id ?? this.generateId(),
        ...sanitizedEntry(Object.fromEntries(columns.map((c) => [c, entry[c] ?? null]))),
      })),
    });
  }

  async createRecords(input: CreateDatasetRecordsInput): Promise<DatasetRecord[]> {
    const parsed = createDatasetRecordsInputSchema.parse(input);

    return this.batchCreateRecords(parsed);
  }

  async updateRecord(input: UpdateDatasetRecordInput): Promise<DatasetRecord> {
    const parsed = updateDatasetRecordInputSchema.parse(input);
    const dataset = await this.getBySlugOrId({
      slugOrId: parsed.slugOrId,
      projectId: parsed.projectId,
    });
    this.assertReady(dataset);
    await this.options.attachments.assertAccepted({
      projectId: parsed.projectId,
      columnTypes: dataset.columnTypes,
      entries: [parsed.updatedRecord],
      findHeld: () => this.findHeldEntries(dataset, parsed.projectId, parsed.recordId),
    });
    if (dataset.contentLayout === "s3_jsonl" && this.options.content) {
      const result = await this.options.content.upsertRecord({
        dataset,
        input: { ...parsed, recordId: parsed.recordId },
      });

      return result.record;
    }

    try {
      return await this.options.records.update({
        id: parsed.recordId,
        datasetId: dataset.id,
        projectId: parsed.projectId,
        entry: sanitizedEntry(parsed.updatedRecord),
      });
    } catch (error) {
      if (isDatasetRecordNotFound(error)) {
        throw new DatasetRecordNotFoundError();
      }

      throw error;
    }
  }

  async deleteRecords(input: DeleteDatasetRecordsInput): Promise<{ count: number }> {
    const parsed = deleteDatasetRecordsInputSchema.parse(input);
    await this.deps.requestBounds.assertBatchSize(parsed.projectId, parsed.recordIds.length);
    const dataset = await this.getBySlugOrId({
      slugOrId: parsed.slugOrId,
      projectId: parsed.projectId,
    });
    this.assertReady(dataset);
    if (dataset.contentLayout === "s3_jsonl" && this.options.content) {
      return this.options.content.deleteRecords({ dataset, input: parsed });
    }

    const count = await this.options.records.deleteMany({
      ...parsed,
      datasetId: dataset.id,
    });

    return { count };
  }
}
