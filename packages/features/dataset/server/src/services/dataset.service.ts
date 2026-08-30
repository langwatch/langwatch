import { nanoid } from "nanoid";
import {
  DatasetRecordNotFoundError,
  DatasetService as DatasetServiceContract,
  copyDatasetInputSchema,
  createDatasetRecordsInputSchema,
  datasetLookupInputSchema,
  datasetWithRecordsInputSchema,
  datasetNameInputSchema,
  datasetPageInputSchema,
  deleteDatasetRecordsInputSchema,
  listDatasetsInputSchema,
  type CopyDatasetInput,
  type CreateDatasetRecordsInput,
  type CreateDatasetFromUploadInput,
  type Dataset,
  type DatasetLookupInput,
  type DatasetNameInput,
  type DatasetNameResult,
  type DatasetPage,
  type DatasetPageInput,
  type DatasetRecord,
  type DatasetListResult,
  type DatasetHead,
  type DatasetRecordPage,
  type DatasetRecordMutationResult,
  type DatasetWithRecords,
  type DeleteDatasetRecordsInput,
  type ListDatasetsInput,
  type PendingUploadInput,
  type PendingUploadResult,
  type StagedUploadInput,
  type AbortPendingUploadInput,
  type FinalizeUploadInput,
  type RetryNormalizeInput,
  type UpdateDatasetRecordInput,
  type UploadExistingDatasetInput,
  type UpsertDatasetInput,
  updateDatasetRecordInputSchema,
  upsertDatasetInputSchema,
} from "@langwatch/dataset-contract";
import type {
  DatasetNormalizeQueuePort,
  DatasetUploadPort,
  DatasetContentPort,
} from "../ports/dataset.port";
import { DatasetConflictError, DatasetNotFoundError, DatasetNotReadyError } from "./errors";
import type { DatasetStorageResolver } from "../ports/dataset-storage.port";
import type { DatasetRepository, DatasetUpdateInput } from "../repositories/dataset.repository";
import type { DatasetRecordRepository } from "../repositories/dataset-record.repository";

export type DatasetServiceOptions = {
  repository: DatasetRepository;
  records: DatasetRecordRepository;
  uploads?: DatasetUploadPort;
  queue?: DatasetNormalizeQueuePort;
  content?: DatasetContentPort;
  storageResolver?: DatasetStorageResolver;
  generateId?: () => string;
};

export class DatasetService extends DatasetServiceContract {
  private readonly generateId: () => string;

  private constructor(private readonly options: DatasetServiceOptions) {
    super();
    this.generateId = options.generateId ?? nanoid;
  }

  static create(options: DatasetServiceOptions): DatasetService {
    return new DatasetService(options);
  }

  async upsertDataset(input: UpsertDatasetInput): Promise<Dataset> {
    const parsed = upsertDatasetInputSchema.parse(input);
    const name = parsed.name.trim();
    const slug = slugify(name);
    if (parsed.datasetId) {
      const existing = await this.getBySlugOrId({
        projectId: parsed.projectId,
        slugOrId: parsed.datasetId,
      });
      this.assertReady(existing);
      const conflict = await this.options.repository.tryFindBySlug({
        projectId: parsed.projectId,
        slug,
        excludeId: existing.id,
      });
      if (conflict) throw new DatasetConflictError();
      const update: DatasetUpdateInput = {
        id: existing.id,
        projectId: parsed.projectId,
        name,
        slug,
        columnTypes: parsed.columnTypes,
      };
      if (
        existing.contentLayout === "s3_jsonl" &&
        this.options.content &&
        JSON.stringify(existing.columnTypes) !== JSON.stringify(parsed.columnTypes)
      ) {
        return this.options.content.updateColumns({
          dataset: existing,
          projectId: parsed.projectId,
          name,
          slug,
          columnTypes: parsed.columnTypes,
        });
      }
      return this.options.repository.update(update);
    }

    const conflict = await this.options.repository.tryFindBySlug({
      projectId: parsed.projectId,
      slug,
    });
    if (conflict) throw new DatasetConflictError();
    const created = await this.options.repository.create({
      projectId: parsed.projectId,
      name,
      slug,
      columnTypes: parsed.columnTypes,
    });
    if (parsed.datasetRecords && parsed.datasetRecords.length > 0) {
      await this.options.records.createMany({
        datasetId: created.id,
        projectId: parsed.projectId,
        entries: parsed.datasetRecords.map((entry) => ({
          ...entry,
          id: entry.id ?? this.generateId(),
        })),
      });
    }
    return created;
  }

  async validateDatasetName(input: DatasetNameInput): Promise<DatasetNameResult> {
    const parsed = datasetNameInputSchema.parse(input);
    const slug = slugify(parsed.proposedName);
    const conflict = await this.options.repository.tryFindBySlug({
      projectId: parsed.projectId,
      slug,
      excludeId: parsed.excludeDatasetId,
    });
    return {
      available: conflict === null,
      slug,
      ...(conflict ? { conflictsWith: conflict.id } : {}),
    };
  }

  async findNextAvailableName(input: DatasetNameInput): Promise<string> {
    const parsed = datasetNameInputSchema.parse(input);
    const baseName = parsed.proposedName.trim();
    if ((await this.validateDatasetName(parsed)).available) return baseName;
    for (let index = 2; index < 10_000; index += 1) {
      const candidate = `${baseName} ${index}`;
      if (
        (
          await this.validateDatasetName({
            ...parsed,
            proposedName: candidate,
          })
        ).available
      ) {
        return candidate;
      }
    }
    throw new DatasetConflictError("Unable to find an available dataset name");
  }

  async getBySlugOrId(input: DatasetLookupInput): Promise<Dataset> {
    const parsed = datasetLookupInputSchema.parse(input);
    const dataset =
      (await this.options.repository.tryFindById({
        id: parsed.slugOrId,
        projectId: parsed.projectId,
      })) ??
      (await this.options.repository.tryFindBySlug({
        projectId: parsed.projectId,
        slug: parsed.slugOrId,
      }));
    if (!dataset) throw new DatasetNotFoundError();
    return dataset;
  }

  async getByIds(input: { projectId: string; datasetIds: string[] }): Promise<Dataset[]> {
    const datasets = await Promise.all(
      input.datasetIds.map(async (datasetId) => {
        try {
          return await this.getBySlugOrId({
            slugOrId: datasetId,
            projectId: input.projectId,
          });
        } catch (error) {
          if (error instanceof DatasetNotFoundError) return null;
          throw error;
        }
      }),
    );
    return datasets.filter((dataset): dataset is Dataset => dataset !== null);
  }

  async renameDataset(input: {
    datasetId: string;
    projectId: string;
    name: string;
  }): Promise<Dataset> {
    const dataset = await this.getBySlugOrId({
      slugOrId: input.datasetId,
      projectId: input.projectId,
    });
    return this.options.repository.update({
      id: dataset.id,
      projectId: input.projectId,
      name: input.name,
      slug: dataset.slug,
      columnTypes: dataset.columnTypes,
    });
  }

  async listDatasets(input: ListDatasetsInput): Promise<DatasetListResult> {
    const parsed = listDatasetsInputSchema.parse(input);
    const data = await this.options.repository.list(parsed);
    return {
      data,
      pagination: {
        page: parsed.page ?? 1,
        limit: parsed.limit ?? 50,
        total: data.length,
        totalPages: data.length === 0 ? 0 : 1,
      },
    };
  }

  async archiveDataset(input: DatasetLookupInput): Promise<{ id: string; archived: true }> {
    const parsed = datasetLookupInputSchema.parse(input);
    const dataset = await this.getBySlugOrId({
      slugOrId: parsed.slugOrId,
      projectId: parsed.projectId,
    });
    this.assertReady(dataset);
    await this.options.repository.archive({
      id: dataset.id,
      projectId: parsed.projectId,
      slug: `${dataset.slug}-archived-${this.generateId()}`,
      archivedAt: new Date(),
    });
    return { id: dataset.id, archived: true };
  }

  async restoreDataset(input: {
    datasetId: string;
    projectId: string;
  }): Promise<{ success: true }> {
    const dataset = await this.options.repository.tryFindById({
      id: input.datasetId,
      projectId: input.projectId,
      includeArchived: true,
    });
    if (!dataset) throw new DatasetNotFoundError();
    await this.options.repository.restore({
      id: dataset.id,
      projectId: input.projectId,
      slug: slugify(dataset.name),
    });
    return { success: true };
  }

  async updateMapping(input: {
    datasetId: string;
    projectId: string;
    mapping?: { mapping: Record<string, unknown>; expansions: string[] };
    threadMapping?: { mapping: Record<string, unknown> };
  }): Promise<Dataset> {
    const dataset = await this.getBySlugOrId({
      slugOrId: input.datasetId,
      projectId: input.projectId,
    });
    const existing = (dataset.mapping as Record<string, unknown> | null) ?? {};
    return this.options.repository.updateMapping({
      id: dataset.id,
      projectId: input.projectId,
      mapping: {
        ...existing,
        ...(input.mapping ? { traceMapping: input.mapping } : {}),
        ...(input.threadMapping ? { threadMapping: input.threadMapping } : {}),
      },
    });
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
      entrySelection?: import("@langwatch/dataset-contract").DatasetEntrySelection;
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
      if (result.data.length < 200 || records.length >= result.pagination.total) break;
      page += 1;
    }
    const selected = selectRecords(records, parsed.entrySelection);
    const limited = limitRecordsByBytes(selected, parsed.limitMb ?? 5);
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
          entry: parsed.updatedRecord,
        }),
        created: false,
      };
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    const [record] = await this.options.records.createMany({
      datasetId: dataset.id,
      projectId: parsed.projectId,
      entries: [{ id: parsed.recordId, ...parsed.updatedRecord }],
    });
    if (!record) throw new Error("Dataset record creation returned no record");
    return { record, created: true };
  }

  async batchCreateRecords(input: CreateDatasetRecordsInput): Promise<DatasetRecord[]> {
    const parsed = createDatasetRecordsInputSchema.parse(input);
    const dataset = await this.getBySlugOrId({
      slugOrId: parsed.slugOrId,
      projectId: parsed.projectId,
    });
    this.assertReady(dataset);
    if (dataset.contentLayout === "s3_jsonl" && this.options.content) {
      return this.options.content.batchCreateRecords({ dataset, input: parsed });
    }
    const columns = dataset.columnTypes.map((column) => column.name);
    return this.options.records.createMany({
      datasetId: dataset.id,
      projectId: parsed.projectId,
      entries: parsed.entries.map((entry) => ({
        id: entry.id ?? this.generateId(),
        ...Object.fromEntries(columns.map((column) => [column, entry[column] ?? null])),
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
        entry: parsed.updatedRecord,
      });
    } catch (error) {
      if (isNotFound(error)) throw new DatasetRecordNotFoundError();
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

  async uploadToExistingDataset(
    input: UploadExistingDatasetInput,
  ): Promise<{ datasetId: string; recordsCreated: number }> {
    if (!this.options.uploads) throw new Error("Dataset upload capability is not configured");
    return this.options.uploads.uploadToExistingDataset(input);
  }

  async createDatasetFromUpload(
    input: CreateDatasetFromUploadInput,
  ): Promise<import("@langwatch/dataset-contract").CreateDatasetFromUploadResult> {
    if (!this.options.uploads) throw new Error("Dataset upload capability is not configured");
    return this.options.uploads.createDatasetFromUpload(input);
  }

  async createPendingUpload(input: PendingUploadInput): Promise<PendingUploadResult> {
    if (!this.options.uploads) throw new Error("Dataset upload capability is not configured");
    return this.options.uploads.createPendingUpload(input);
  }

  async writeStagedUpload(input: StagedUploadInput): Promise<void> {
    if (!this.options.uploads) throw new Error("Dataset upload capability is not configured");
    return this.options.uploads.writeStagedUpload(input);
  }

  async abortPendingUpload(
    input: AbortPendingUploadInput,
  ): Promise<{ datasetId: string; aborted: true }> {
    if (!this.options.uploads) throw new Error("Dataset upload capability is not configured");
    return this.options.uploads.abortPendingUpload(input);
  }

  async finalizeUpload(
    input: FinalizeUploadInput,
  ): Promise<{ datasetId: string; status: "processing" }> {
    if (!this.options.uploads) throw new Error("Dataset upload capability is not configured");
    const result = await this.options.uploads.finalizeUpload(input);
    await this.enqueueNormalize(input.projectId, input.datasetId);
    return result;
  }

  async retryNormalize(
    input: RetryNormalizeInput,
  ): Promise<{ datasetId: string; status: "processing" }> {
    if (!this.options.uploads) throw new Error("Dataset upload capability is not configured");
    const result = await this.options.uploads.retryNormalize(input);
    await this.enqueueNormalize(input.projectId, input.datasetId);
    return result;
  }

  async copyDataset(input: CopyDatasetInput): Promise<Dataset> {
    const parsed = copyDatasetInputSchema.parse(input);
    const source = await this.getBySlugOrId({
      projectId: parsed.sourceProjectId,
      slugOrId: parsed.sourceDatasetId,
    });
    const name = await this.findNextAvailableName({
      projectId: parsed.targetProjectId,
      proposedName: source.name,
    });
    const target = await this.upsertDataset({
      projectId: parsed.targetProjectId,
      name,
      columnTypes: source.columnTypes,
    });
    if (
      source.contentLayout === "s3_jsonl" &&
      target.contentLayout === "s3_jsonl" &&
      this.options.content
    ) {
      await this.options.content.copyDataset({
        source,
        sourceProjectId: parsed.sourceProjectId,
        target,
        targetProjectId: parsed.targetProjectId,
      });
      return target;
    }
    const records = await this.options.records.list({
      datasetId: source.id,
      projectId: parsed.sourceProjectId,
      page: 1,
      limit: 200,
    });
    if (records.records.length > 0) {
      await this.options.records.createMany({
        datasetId: target.id,
        projectId: parsed.targetProjectId,
        entries: records.records.map((record) => ({
          id: this.generateId(),
          ...record.entry,
        })),
      });
    }
    return target;
  }

  private assertReady(dataset: Dataset): void {
    if (dataset.status !== "ready") {
      throw new DatasetNotReadyError({ status: dataset.status });
    }
  }

  private async enqueueNormalize(projectId: string, datasetId: string): Promise<void> {
    if (!this.options.queue) return;
    await this.options.queue.enqueueNormalize({ projectId, datasetId });
  }
}

function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replaceAll(/[^\p{L}\p{N}]+/gu, "-")
    .replaceAll(/^-+|-+$/g, "")
    .toLowerCase();
  return slug || "dataset";
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && error.name === "DatasetRecordNotFoundError";
}

function selectRecords(
  records: DatasetRecord[],
  selection: import("@langwatch/dataset-contract").DatasetEntrySelection,
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
          : Math.min(Math.max(selection, 0), records.length - 1);
  return [records[index]!];
}

function limitRecordsByBytes(
  records: DatasetRecord[],
  limitMb: number | null,
): { records: DatasetRecord[]; truncated: boolean } {
  if (limitMb === null) return { records, truncated: false };
  const limitBytes = limitMb * 1024 * 1024;
  let bytes = 0;
  const result: DatasetRecord[] = [];
  for (const record of records) {
    const recordBytes = JSON.stringify(record.entry).length;
    if (bytes + recordBytes >= limitBytes) {
      return { records: result, truncated: true };
    }
    bytes += recordBytes;
    result.push(record);
  }
  return { records: result, truncated: false };
}
