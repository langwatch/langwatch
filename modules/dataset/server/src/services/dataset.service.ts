import { nowInstant } from "@langwatch/time";
import { nanoid } from "nanoid";
import {
  copyDatasetInputSchema,
  datasetLookupInputSchema,
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
  type DatasetEntrySelection,
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
  upsertDatasetInputSchema,
} from "@langwatch/dataset-contract";
import type {
  DatasetNormalizeQueuePort,
  DatasetUploadPort,
  DatasetContentPort,
} from "../ports/dataset.port.ts";
import {
  DatasetConflictError,
  DatasetNotFoundError,
  DatasetNotReadyError,
} from "@langwatch/dataset-contract";
import { DatasetRecordService } from "./dataset-record.service.ts";
import { DatasetNamingService } from "./dataset-naming.service.ts";
import { assertKnownColumns } from "../rules/dataset-columns.rules.ts";
import { datasetSlugOf } from "../rules/dataset-selection.rules.ts";
import type { DatasetStorageResolverPort } from "../ports/dataset-storage.port.ts";
import type { DatasetRepository, DatasetUpdateInput } from "../repositories/dataset.repository.ts";
import type { DatasetRecordRepository } from "../repositories/dataset-record.repository.ts";

export type DatasetServiceOptions = {
  repository: DatasetRepository;
  records: DatasetRecordRepository;
  uploads?: DatasetUploadPort;
  queue?: DatasetNormalizeQueuePort;
  content?: DatasetContentPort;
  storageResolver?: DatasetStorageResolverPort;
  generateId?: () => string;
};

export class DatasetService {
  private readonly generateId: () => string;

  private readonly records: DatasetRecordService;

  private readonly naming: DatasetNamingService;

  private constructor(private readonly options: DatasetServiceOptions) {
    this.generateId = options.generateId ?? nanoid;
    this.naming = DatasetNamingService.create(options.repository);
    this.records = DatasetRecordService.create({
      options,
      getBySlugOrId: (input) => this.getBySlugOrId(input),
      assertReady: (dataset) => this.assertReady(dataset),
      assertKnownColumns: (columns) => assertKnownColumns(columns),
      generateId: () => this.generateId(),
    });
  }

  static create(options: DatasetServiceOptions): DatasetService {
    return new DatasetService(options);
  }

  async upsertDataset(input: UpsertDatasetInput): Promise<Dataset> {
    const parsed = upsertDatasetInputSchema.parse(input);
    const name = parsed.name.trim();
    const slug = datasetSlugOf(name);
    if (parsed.datasetId) {
      const existing = await this.getBySlugOrId({
        projectId: parsed.projectId,
        slugOrId: parsed.datasetId,
      });
      this.assertReady(existing);
      const conflict = await this.options.repository.findBySlug({
        projectId: parsed.projectId,
        slug,
        excludeId: existing.id,
      });
      if (conflict) {
        throw new DatasetConflictError();
      }

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

    const conflict = await this.options.repository.findBySlug({
      projectId: parsed.projectId,
      slug,
    });
    if (conflict) {
      throw new DatasetConflictError();
    }

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

  validateDatasetName(input: DatasetNameInput): Promise<DatasetNameResult> {
    return this.naming.validateDatasetName(input);
  }

  findNextAvailableName(input: DatasetNameInput): Promise<string> {
    return this.naming.findNextAvailableName(input);
  }

  async getBySlugOrId(input: DatasetLookupInput): Promise<Dataset> {
    const parsed = datasetLookupInputSchema.parse(input);
    const dataset =
      (await this.options.repository.findById({
        id: parsed.slugOrId,
        projectId: parsed.projectId,
      })) ??
      (await this.options.repository.findBySlug({
        projectId: parsed.projectId,
        slug: parsed.slugOrId,
      }));
    if (!dataset) {
      throw new DatasetNotFoundError();
    }

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
          if (error instanceof DatasetNotFoundError) {
            return null;
          }

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
      archivedAt: nowInstant(),
    });

    return { id: dataset.id, archived: true };
  }

  async restoreDataset(input: {
    datasetId: string;
    projectId: string;
  }): Promise<{ success: true }> {
    const dataset = await this.options.repository.findById({
      id: input.datasetId,
      projectId: input.projectId,
      includeArchived: true,
    });
    if (!dataset) {
      throw new DatasetNotFoundError();
    }

    await this.options.repository.restore({
      id: dataset.id,
      projectId: input.projectId,
      slug: datasetSlugOf(dataset.name),
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
    return this.records.listRecords(input);
  }

  async getDatasetPage(input: DatasetPageInput): Promise<DatasetPage> {
    return this.records.getDatasetPage(input);
  }

  async getDatasetWithRecords(
    input: DatasetLookupInput & {
      limitMb?: number | null;
      entrySelection?: DatasetEntrySelection;
    },
  ): Promise<DatasetWithRecords> {
    return this.records.getDatasetWithRecords(input);
  }

  async getDatasetHead(input: DatasetLookupInput): Promise<DatasetHead> {
    return this.records.getDatasetHead(input);
  }

  async upsertRecord(
    input: UpdateDatasetRecordInput & { recordId: string },
  ): Promise<DatasetRecordMutationResult> {
    return this.records.upsertRecord(input);
  }

  async batchCreateRecords(input: CreateDatasetRecordsInput): Promise<DatasetRecord[]> {
    return this.records.batchCreateRecords(input);
  }

  async createRecords(input: CreateDatasetRecordsInput): Promise<DatasetRecord[]> {
    return this.records.createRecords(input);
  }

  async updateRecord(input: UpdateDatasetRecordInput): Promise<DatasetRecord> {
    return this.records.updateRecord(input);
  }

  async deleteRecords(input: DeleteDatasetRecordsInput): Promise<{ count: number }> {
    return this.records.deleteRecords(input);
  }

  async uploadToExistingDataset(
    input: UploadExistingDatasetInput,
  ): Promise<{ datasetId: string; recordsCreated: number }> {
    if (!this.options.uploads) {
      throw new Error("Dataset upload capability is not configured");
    }

    return this.options.uploads.uploadToExistingDataset(input);
  }

  async createDatasetFromUpload(
    input: CreateDatasetFromUploadInput,
  ): Promise<import("@langwatch/dataset-contract").CreateDatasetFromUploadResult> {
    if (!this.options.uploads) {
      throw new Error("Dataset upload capability is not configured");
    }

    return this.options.uploads.createDatasetFromUpload(input);
  }

  async createPendingUpload(input: PendingUploadInput): Promise<PendingUploadResult> {
    if (!this.options.uploads) {
      throw new Error("Dataset upload capability is not configured");
    }

    return this.options.uploads.createPendingUpload(input);
  }

  async writeStagedUpload(input: StagedUploadInput): Promise<void> {
    if (!this.options.uploads) {
      throw new Error("Dataset upload capability is not configured");
    }

    return this.options.uploads.writeStagedUpload(input);
  }

  async abortPendingUpload(
    input: AbortPendingUploadInput,
  ): Promise<{ datasetId: string; aborted: true }> {
    if (!this.options.uploads) {
      throw new Error("Dataset upload capability is not configured");
    }

    return this.options.uploads.abortPendingUpload(input);
  }

  async finalizeUpload(
    input: FinalizeUploadInput,
  ): Promise<{ datasetId: string; status: "processing" }> {
    if (!this.options.uploads) {
      throw new Error("Dataset upload capability is not configured");
    }

    const result = await this.options.uploads.finalizeUpload(input);
    await this.enqueueNormalize(input.projectId, input.datasetId);

    return result;
  }

  async retryNormalize(
    input: RetryNormalizeInput,
  ): Promise<{ datasetId: string; status: "processing" }> {
    if (!this.options.uploads) {
      throw new Error("Dataset upload capability is not configured");
    }

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
    if (!this.options.queue) {
      return;
    }

    await this.options.queue.enqueueNormalize({ projectId, datasetId });
  }
}
