/**
 * Reading and writing a dataset's records: the inline Postgres rows, and the s3_jsonl content
 * port that answers for datasets whose rows live in object storage.
 */
import {
  DatasetRecordNotFoundError,
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
} from "../rules/dataset-selection.rules";
import type { DatasetServiceOptions } from "./dataset.service";

type DatasetRecordServiceOptions = {
  options: DatasetServiceOptions;
  /** The owning service's own lookup, so a record read refuses a missing dataset alike. */
  getBySlugOrId: (input: DatasetLookupInput) => Promise<Dataset>;
  assertReady: (dataset: Dataset) => void;
  assertKnownColumns: (input: {
    datasetName: string;
    columns: string[];
    entries: ReadonlyArray<Record<string, unknown>>;
  }) => void;
  generateId: () => string;
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
    if (dataset.contentLayout === "s3_jsonl" && this.options.content) {
      return this.options.content.listRecords({ dataset, input: parsed });
    }

    const result = await this.options.records.list({
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

    const page = await this.options.records.list({
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
    while (true) {
      const result = await this.listRecords({
        slugOrId: parsed.slugOrId,
        projectId: parsed.projectId,
        page,
        limit: 200,
      });
      records.push(...result.data);
      if (result.data.length < 200 || records.length >= result.pagination.total) {
        break;
      }

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

  async batchCreateRecords(input: CreateDatasetRecordsInput): Promise<DatasetRecord[]> {
    const parsed = createDatasetRecordsInputSchema.parse(input);
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
