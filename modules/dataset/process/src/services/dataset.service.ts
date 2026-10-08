import { NotFoundError } from "@langwatch/api/rest";
import {
  datasetLookupInputSchema,
  listDatasetsInputSchema,
  type CopyDatasetInput,
  type CreateDatasetRecordsInput,
  type AppendStoredObjectToDatasetInput,
  type CreateDatasetFromStoredObjectInput,
  type CreateDatasetFromUploadInput,
  type DatasetImportAppended,
  type DatasetImportStarted,
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
  type DatasetApiDeleteInput,
  type DeleteDatasetRecordsInput,
  type ListDatasetsInput,
  type RetryNormalizeInput,
  type UpdateDatasetRecordInput,
  type UploadExistingDatasetInput,
  type UpsertDatasetInput,
  DatasetNotFoundError,
  DatasetNotReadyError,
  DatasetTooLargeToReadInlineError,
} from "@langwatch/dataset-contract";
import type * as datasetContractModule from "@langwatch/dataset-contract";
import { generate } from "@langwatch/ksuid";
import { nowInstant } from "@langwatch/time";

import type { DatasetNormalizeQueue, DatasetUpload, DatasetContent } from "../app/dataset.app.ts";
import type { DatasetRecordRepository } from "../repositories/dataset-record.repository.ts";
import type { DatasetRepository } from "../repositories/dataset.repository.ts";
import { assertKnownColumns } from "../rules/dataset-columns.rules.ts";
import type { DatasetAttachmentReferenceService } from "./dataset-attachment-reference.service.ts";
import { DatasetCopyService } from "./dataset-copy.service.ts";
import type { DatasetInlineAttachmentService } from "./dataset-inline-attachment.service.ts";
import { DatasetNamingService } from "./dataset-naming.service.ts";
import { DatasetRecordService } from "./dataset-record.service.ts";
import type { DatasetRequestBoundsService } from "./dataset-request-bounds.service.ts";
import { DatasetUpsertService } from "./dataset-upsert.service.ts";

export type DatasetServiceOptions = {
  repository: DatasetRepository;
  records: DatasetRecordRepository;
  uploads?: DatasetUpload;
  queue?: DatasetNormalizeQueue;
  content?: DatasetContent;
  generateId?: () => string;
  /** The tier-aware batch bound the record writes refuse above. */
  requestBounds: DatasetRequestBoundsService;
  /** Checks the stored-file references a record write brings in (ADR-158 §6). */
  attachments: DatasetAttachmentReferenceService;
  /** Stores the files a row carries inline and leaves their references. */
  inlineAttachments: Pick<DatasetInlineAttachmentService, "store" | "storeAll">;
};

/**
 * The default id minter, used only where a composition (a test, most often)
 * supplies no `generateId` of its own — every real composition already does
 * (`dataset.app.ts`'s own `DATASET_RECORD_KSUID_RESOURCE`).
 */
const DATASET_RECORD_KSUID_RESOURCE = "datasetrecord";

/** Archiving appends `-archived-<id>` to the slug; the live slug is what precedes the last one. */
function liveSlugOf(slug: string): string {
  const suffixAt = slug.lastIndexOf("-archived-");

  return suffixAt === -1 ? slug : slug.slice(0, suffixAt);
}

export class DatasetService {
  private readonly generateId: () => string;

  private readonly records: DatasetRecordService;

  private readonly naming: DatasetNamingService;

  private readonly upserts: DatasetUpsertService;

  private readonly copies: DatasetCopyService;

  private constructor(private readonly options: DatasetServiceOptions) {
    this.generateId =
      options.generateId ?? (() => generate(DATASET_RECORD_KSUID_RESOURCE).toString());
    this.naming = DatasetNamingService.create(options.repository);
    this.upserts = DatasetUpsertService.create({
      options,
      getBySlugOrId: (input) => this.getBySlugOrId(input),
      assertReady: (dataset) => this.assertReady(dataset),
      generateId: () => this.generateId(),
    });
    this.copies = DatasetCopyService.create({
      options,
      getBySlugOrId: (input) => this.getBySlugOrId(input),
      findNextAvailableName: (input) => this.findNextAvailableName(input),
      upsertDataset: (input) => this.upsertDataset(input),
      generateId: () => this.generateId(),
    });
    this.records = DatasetRecordService.create({
      options,
      getBySlugOrId: (input) => this.getBySlugOrId(input),
      assertReady: (dataset) => this.assertReady(dataset),
      assertKnownColumns: (columns) => assertKnownColumns(columns),
      generateId: () => this.generateId(),
      requestBounds: options.requestBounds,
    });
  }

  static create(options: DatasetServiceOptions): DatasetService {
    return new DatasetService(options);
  }

  upsertDataset(input: UpsertDatasetInput): Promise<Dataset> {
    return this.upserts.upsertDataset(input);
  }

  validateDatasetName(input: DatasetNameInput): Promise<DatasetNameResult> {
    return this.naming.validateDatasetName(input);
  }

  findNextAvailableName(input: DatasetNameInput): Promise<string> {
    return this.naming.findNextAvailableName(input);
  }

  /** Slug only, archived rows included, as main's `dataset.findFirst({ slug, projectId })` read. */
  async findBySlug(input: { projectId: string; slug: string }): Promise<Dataset[]> {
    const dataset = await this.options.repository.findBySlug({
      projectId: input.projectId,
      slug: input.slug,
      includeArchived: true,
    });

    return dataset ? [dataset] : [];
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
    const data = await this.options.repository.findAll(parsed);

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

  /** Undo restores the slug the dataset had before archiving, not one re-derived from its name. */
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
      slug: liveSlugOf(dataset.slug),
    });

    return { success: true };
  }

  /** Archives the dataset, or restores it on undo; archiving twice keeps the first archive. */
  async archiveOrRestoreDataset(input: DatasetApiDeleteInput): Promise<{ success: true }> {
    const dataset = await this.options.repository.findById({
      id: input.datasetId,
      projectId: input.projectId,
      includeArchived: true,
    });
    if (!dataset) return { success: true };
    if (input.undo) {
      await this.restoreDataset({ datasetId: dataset.id, projectId: input.projectId });

      return { success: true };
    }
    if (dataset.archivedAt) return { success: true };

    await this.archiveDataset({ slugOrId: dataset.id, projectId: input.projectId });

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

  /**
   * The whole dataset in one answer, refused rather than truncated when it is
   * larger than the organization answers inline. The refusal names paging,
   * which has no ceiling on the dataset's size.
   */
  async getDatasetWithinLimit(input: DatasetLookupInput): Promise<DatasetWithRecords> {
    const read = await this.getDatasetWithRecords(input);
    if (read.truncated) {
      throw new DatasetTooLargeToReadInlineError({
        maxBytes: await this.options.requestBounds.limit(input.projectId, "inlineReadBytes"),
        totalRows: read.totalRows ?? read.records.length,
      });
    }

    return read;
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

  /** Entries removed by id; a batch that matched none is a 404, not an empty success. */
  async deleteMatchingRecords(input: DeleteDatasetRecordsInput): Promise<{ deletedCount: number }> {
    const result = await this.deleteRecords(input);
    if (result.count === 0) throw new NotFoundError("No matching records found");

    return { deletedCount: result.count };
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
  ): Promise<datasetContractModule.CreateDatasetFromUploadResult> {
    if (!this.options.uploads) {
      throw new Error("Dataset upload capability is not configured");
    }

    return this.options.uploads.createDatasetFromUpload(input);
  }

  async createDatasetFromStoredObject(
    input: CreateDatasetFromStoredObjectInput,
  ): Promise<DatasetImportStarted> {
    if (!this.options.uploads) {
      throw new Error("Dataset upload capability is not configured");
    }

    const started = await this.options.uploads.createDatasetFromStoredObject(input);
    await this.enqueueNormalize(input.projectId, started.datasetId);

    return started;
  }

  async appendStoredObjectToDataset(
    input: AppendStoredObjectToDatasetInput,
  ): Promise<DatasetImportAppended> {
    if (!this.options.uploads) {
      throw new Error("Dataset upload capability is not configured");
    }

    return this.options.uploads.appendStoredObjectToDataset(input);
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

  copyDataset(input: CopyDatasetInput): Promise<Dataset> {
    return this.copies.copyDataset(input);
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
