/**
 * Reading and writing a dataset's records: the inline Postgres rows, and the s3_jsonl content
 * port that answers for datasets whose rows live in object storage.
 */
import {
  DatasetRecordNotFoundError,
  DatasetTooLargeToExportError,
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

import { onceMaxBytes } from "../rules/dataset-inline-file.rules.ts";
import {
  assertPageWithinLimit,
  assertWholeReadWithinLimits,
  entryBytesOf,
} from "../rules/dataset-row-limits.rules.ts";
import { normalizeDatasetSearch } from "../rules/dataset-search.rules.ts";
import {
  isDatasetRecordNotFound,
  limitDatasetRecordsByBytes,
  sanitizedEntry,
  selectDatasetRecords,
} from "../rules/dataset-selection.rules.ts";
import type { InlineAttachmentScope } from "./dataset-inline-attachment.service.ts";
import { DatasetRecordSearchService } from "./dataset-record-search.service.ts";
import type { DatasetRequestBoundsService } from "./dataset-request-bounds.service.ts";
import type { DatasetServiceOptions } from "./dataset.service.ts";

const MIB = 1024 * 1024;

/** How many postgres-backed rows a whole read asks for at a time. */
const WHOLE_READ_PAGE_ROWS = 200;

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
  /** The bounds the project's organization answers for writes and reads. */
  requestBounds: DatasetRequestBoundsService;
};

export class DatasetRecordService {
  static create(deps: DatasetRecordServiceOptions): DatasetRecordService {
    return new DatasetRecordService(deps);
  }

  private readonly search: DatasetRecordSearchService;

  private constructor(private readonly deps: DatasetRecordServiceOptions) {
    this.search = DatasetRecordSearchService.create({
      records: deps.options.records,
      content: deps.options.content,
      requestBounds: deps.requestBounds,
    });
  }

  private get options(): DatasetServiceOptions {
    return this.deps.options;
  }

  private getBySlugOrId(input: DatasetLookupInput): Promise<Dataset> {
    return this.deps.getBySlugOrId(input);
  }

  /**
   * One page of records, refused when it is larger than one response carries.
   * A page of one record is always served.
   */
  async listRecords(input: DatasetPageInput): Promise<DatasetRecordPage> {
    const parsed = datasetPageInputSchema.parse(input);
    const dataset = await this.getBySlugOrId({
      slugOrId: parsed.slugOrId,
      projectId: parsed.projectId,
    });
    const page = await this.readRecordsPage(parsed, dataset);
    assertPageWithinLimit({
      records: page.data,
      page: page.pagination.page,
      limit: page.pagination.limit,
      maxBytes: await this.deps.requestBounds.limit(parsed.projectId, "inlineReadBytes"),
    });

    return { ...page, dataset };
  }

  private async readRecordsPage(
    parsed: ReturnType<typeof datasetPageInputSchema.parse>,
    known?: Dataset,
  ): Promise<DatasetRecordPage> {
    const dataset =
      known ??
      (await this.getBySlugOrId({
        slugOrId: parsed.slugOrId,
        projectId: parsed.projectId,
      }));
    this.deps.assertReady(dataset);
    const search = normalizeDatasetSearch(parsed.search);
    if (search) {
      return this.search.searchRecords({ dataset, input: parsed, search });
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

  async getDatasetPage(input: DatasetPageInput): Promise<DatasetPage> {
    const parsed = datasetPageInputSchema.parse(input);
    const dataset = await this.getBySlugOrId({
      slugOrId: parsed.slugOrId,
      projectId: parsed.projectId,
    });
    this.deps.assertReady(dataset);
    const search = normalizeDatasetSearch(parsed.search);
    if (search) {
      const matches = await this.search.searchRecords({ dataset, input: parsed, search });
      return {
        id: dataset.id,
        name: dataset.name,
        columnTypes: dataset.columnTypes,
        datasetRecords: matches.data,
        count: matches.pagination.total,
        page: matches.pagination.page,
        limit: matches.pagination.limit,
        totalPages: matches.pagination.totalPages,
      };
    }
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

  /**
   * A dataset and its rows up to a byte budget: what the organization answers
   * inline in one response when none is named. `null` asks for every row, and
   * is refused past the organization's whole-read limits. Rows are never skipped.
   */
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
    if (parsed.limitMb !== null) {
      const limitBytes = await this.readBudget(parsed.projectId, parsed.limitMb);

      return this.readWithinBudget({ parsed, dataset, limitBytes });
    }

    const { requestBounds } = this.deps;
    const [maxRows, maxBytes] = await Promise.all([
      requestBounds.limit(parsed.projectId, "rowsMax"),
      requestBounds.limit(parsed.projectId, "wholeReadBytes"),
    ]);
    assertWholeReadWithinLimits({ dataset, maxRows, maxBytes });
    const read = await this.readWithinBudget({ parsed, dataset, limitBytes: maxBytes });
    if (read.truncated) throw new DatasetTooLargeToExportError({ maxBytes });
    assertWholeReadWithinLimits({ rowCount: read.totalRows, maxRows, maxBytes });

    return read;
  }

  private async readWithinBudget(input: {
    parsed: ReturnType<typeof datasetWithRecordsInputSchema.parse>;
    dataset: Dataset;
    limitBytes: number;
  }): Promise<DatasetWithRecords> {
    const { parsed, dataset, limitBytes } = input;
    if (dataset.contentLayout === "s3_jsonl" && this.options.content) {
      return this.options.content.getDatasetWithRecords({
        dataset,
        projectId: parsed.projectId,
        entrySelection: parsed.entrySelection,
        limitBytes,
      });
    }

    // Only a read of every row can stop early; picking one row needs them all.
    const stopAtBytes = parsed.entrySelection === "all" ? limitBytes : null;
    const records: DatasetRecord[] = [];
    let bytes = 0;
    let total = 0;
    let page = 1;
    let hasMoreRecords = true;
    while (hasMoreRecords) {
      const result = await this.readRecordsPage({
        slugOrId: parsed.slugOrId,
        projectId: parsed.projectId,
        page,
        limit: WHOLE_READ_PAGE_ROWS,
      });
      total = result.pagination.total;
      for (const record of result.data) {
        bytes += entryBytesOf(record.entry);
        if (stopAtBytes !== null && bytes > stopAtBytes) {
          return {
            dataset,
            records,
            truncated: true,
            totalRows: Math.max(total, records.length + 1),
          };
        }
        records.push(record);
      }
      const lastPage = result.data.length < WHOLE_READ_PAGE_ROWS;
      const readAllRecords = records.length >= total;
      hasMoreRecords = !lastPage && !readAllRecords;

      page += 1;
    }

    const selected = selectDatasetRecords(records, parsed.entrySelection);
    const limited = limitDatasetRecordsByBytes(selected, limitBytes);

    return {
      dataset,
      records: limited.records,
      truncated: limited.truncated,
      totalRows: selected.length,
    };
  }

  private async readBudget(projectId: string, limitMb: number | undefined): Promise<number> {
    if (limitMb !== undefined) return limitMb * MIB;

    return this.deps.requestBounds.limit(projectId, "inlineReadBytes");
  }

  async getDatasetHead(input: DatasetLookupInput): Promise<DatasetHead> {
    const parsed = datasetLookupInputSchema.parse(input);
    const dataset = await this.getBySlugOrId({
      slugOrId: parsed.slugOrId,
      projectId: parsed.projectId,
    });
    this.deps.assertReady(dataset);
    if (dataset.contentLayout === "s3_jsonl" && this.options.content) {
      return this.options.content.getDatasetHead({ dataset });
    }

    const page = await this.readRecordsPage({
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
    this.deps.assertReady(dataset);
    const scope = this.inlineScope(parsed.projectId, dataset);
    parsed.updatedRecord = await this.options.inlineAttachments.store(scope, parsed.updatedRecord);
    await this.options.attachments.assertAccepted({
      projectId: parsed.projectId,
      columnTypes: dataset.columnTypes,
      entries: [parsed.updatedRecord],
      findHeld: () => this.findHeldEntries(dataset, parsed.projectId, parsed.recordId),
      maxBytes: scope.maxBytes,
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

  /** The dataset's image and file columns, read for files a row carries inline. */
  private inlineScope(projectId: string, dataset: Dataset): InlineAttachmentScope {
    return {
      projectId,
      datasetId: dataset.id,
      columns: { kind: "typed", columnTypes: dataset.columnTypes },
      maxBytes: onceMaxBytes(() => this.deps.requestBounds.limit(projectId, "attachmentBytes")),
    };
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
    this.deps.assertReady(dataset);
    const columns = dataset.columnTypes.map((column) => column.name);
    this.deps.assertKnownColumns({
      datasetName: dataset.name,
      columns,
      entries: parsed.entries,
    });
    const scope = this.inlineScope(parsed.projectId, dataset);
    parsed.entries = await this.options.inlineAttachments.storeAll(scope, parsed.entries);
    await this.options.attachments.assertAccepted({
      projectId: parsed.projectId,
      columnTypes: dataset.columnTypes,
      entries: parsed.entries,
      maxBytes: scope.maxBytes,
    });
    if (dataset.contentLayout === "s3_jsonl" && this.options.content) {
      return this.options.content.batchCreateRecords({ dataset, input: parsed });
    }

    return this.options.records.createMany({
      datasetId: dataset.id,
      projectId: parsed.projectId,
      entries: parsed.entries.map((entry) => ({
        id: entry.id ?? this.deps.generateId(),
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
    this.deps.assertReady(dataset);
    const scope = this.inlineScope(parsed.projectId, dataset);
    parsed.updatedRecord = await this.options.inlineAttachments.store(scope, parsed.updatedRecord);
    await this.options.attachments.assertAccepted({
      projectId: parsed.projectId,
      columnTypes: dataset.columnTypes,
      entries: [parsed.updatedRecord],
      findHeld: () => this.findHeldEntries(dataset, parsed.projectId, parsed.recordId),
      maxBytes: scope.maxBytes,
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
    this.deps.assertReady(dataset);
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
