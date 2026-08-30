import { nanoid } from "nanoid";
import {
  convertRowsToColumnTypes,
  datasetColumnsSchema,
  detectFileFormat,
  MAX_FILE_SIZE_BYTES,
  MAX_ROWS_LIMIT,
  parseFileContent,
  renameReservedColumns,
} from "@langwatch/dataset-contract";
import type {
  CreateDatasetFromUploadInput,
  CreateDatasetFromUploadResult,
  PendingUploadInput,
  PendingUploadResult,
  StagedUploadInput,
  UploadExistingDatasetInput,
  AbortPendingUploadInput,
  FinalizeUploadInput,
  RetryNormalizeInput,
  DatasetColumns,
} from "@langwatch/dataset-contract";
import type { Readable } from "node:stream";
import type { Dataset, Prisma, PrismaClient } from "@langwatch/prisma-client/generated";
import { DatasetContentRepository } from "../repositories/prisma/dataset-content.repository";
import { DatasetRecordContentRepository } from "../repositories/prisma/dataset-record-content.repository";
import type { DatasetStorageResolver } from "../ports/dataset-storage.port";
import type { DatasetUploadPort } from "../ports/dataset.port";
import {
  DatasetConflictError,
  DatasetNotFoundError,
  DirectUploadUnavailableError,
  StagedUploadNotFoundError,
  UploadNotPendingError,
  UploadTooLargeError,
  UploadValidationError,
} from "../services/errors";
import { exceedsUploadCap, stagingUploadKey, UPLOAD_MAX_BYTES } from "../services/presigned-upload";
import { DatasetChunkService } from "../services/dataset-chunk.service";
import { stripNullBytes } from "../services/sanitize";

/** Owns upload lifecycle behavior; routes only see DatasetService's contract. */
export class DatasetUploadAdapter implements DatasetUploadPort {
  static create(options: {
    prisma: PrismaClient;
    datasets: DatasetContentRepository;
    records: DatasetRecordContentRepository;
    storageResolver: DatasetStorageResolver;
  }): DatasetUploadAdapter {
    return new DatasetUploadAdapter(
      options.prisma,
      options.datasets,
      options.records,
      options.storageResolver,
    );
  }
  private readonly chunks: DatasetChunkService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly datasets: DatasetContentRepository,
    private readonly records: DatasetRecordContentRepository,
    private readonly storageResolver: DatasetStorageResolver,
  ) {
    this.chunks = DatasetChunkService.create({ datasets });
  }

  async uploadToExistingDataset(
    input: UploadExistingDatasetInput,
  ): Promise<{ datasetId: string; recordsCreated: number }> {
    this.assertFile(input.filename, input.content, input.fileSize);
    const dataset = await this.findDataset(input.slugOrId, input.projectId);
    const { headers, rows } = parseFileContent({
      content: input.content,
      format: detectFileFormat(input.filename),
    });
    const expected = new Set(
      (dataset.columnTypes as Array<{ name: string }>).map((column) => column.name),
    );
    const uploaded = new Set(headers);
    const missing = headers.filter((header) => !expected.has(header));
    const extra = [...expected].filter((column) => !uploaded.has(column));
    if (missing.length || extra.length) {
      throw new UploadValidationError(
        `Uploaded columns do not match the dataset schema`,
        "column_mismatch",
      );
    }
    const columns = datasetColumnsSchema.parse(dataset.columnTypes);
    const converted = convertRowsToColumnTypes(rows, columns);
    const entries = converted.map((entry, index) => ({
      id: `${Date.now()}-${index}`,
      ...entry,
    }));
    if (dataset.contentLayout === "s3_jsonl") {
      const storage = await this.storageResolver.forProject(input.projectId);
      await this.chunks.append({
        dataset,
        projectId: input.projectId,
        entries: entries.map(({ id: _id, ...entry }) => entry),
        forcedIds: entries.map((entry) => entry.id),
        storage,
      });
    } else {
      await this.records.createMany({
        records: entries.map(({ id, ...entry }) => ({
          id,
          entry: stripNullBytes(entry) as Prisma.InputJsonValue,
        })),
        datasetId: dataset.id,
        projectId: input.projectId,
      });
    }
    return { datasetId: dataset.id, recordsCreated: entries.length };
  }

  async createDatasetFromUpload(
    input: CreateDatasetFromUploadInput,
  ): Promise<CreateDatasetFromUploadResult> {
    this.assertFile(input.filename, input.content, input.fileSize);
    const { headers, rows } = parseFileContent({
      content: input.content,
      format: detectFileFormat(input.filename),
    });
    const renamedHeaders = renameReservedColumns(headers);
    const rename = new Map(headers.map((header, index) => [header, renamedHeaders[index]!]));
    const entries = convertRowsToColumnTypes(
      rows.map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => [rename.get(key) ?? key, value]),
        ),
      ),
      renamedHeaders.map((name) => ({ name, type: "string" as const })),
    );
    const datasetId = `dataset_${nanoid()}`;
    const storage = await this.storageResolver.forProject(input.projectId);
    const initial = await this.chunks.writeInitialChunks({
      projectId: input.projectId,
      datasetId,
      entries,
      forcedIds: entries.map(() => undefined),
      storage,
    });
    const dataset = await this.datasets.create({
      id: datasetId,
      projectId: input.projectId,
      name: input.name,
      slug: slugify(input.name),
      columnTypes: renamedHeaders.map((name) => ({ name, type: "string" as const })),
      contentLayout: "s3_jsonl",
      status: "ready",
      rowCount: initial.rowCount,
      sizeBytes: BigInt(initial.sizeBytes),
      chunkCount: initial.chunkCount,
      chunkOffsets: initial.chunkOffsets as Prisma.InputJsonValue,
    });
    return {
      id: dataset.id,
      name: dataset.name,
      slug: dataset.slug,
      columnTypes: dataset.columnTypes as DatasetColumns,
      createdAt: dataset.createdAt,
      updatedAt: dataset.updatedAt,
      recordsCreated: entries.length,
    };
  }

  async createPendingUpload(input: PendingUploadInput): Promise<PendingUploadResult> {
    const slug = slugify(input.name);
    if (await this.datasets.tryFindBySlug({ projectId: input.projectId, slug }))
      throw new DatasetConflictError();
    const storage = await this.storageResolver.forProject(input.projectId);
    const upload = await storage.createPresignedUpload({ projectId: input.projectId });
    const dataset = await this.datasets.create({
      id: `dataset_${nanoid()}`,
      projectId: input.projectId,
      name: input.name,
      slug,
      columnTypes: input.columnTypes ?? [],
      contentLayout: "s3_jsonl",
      status: "uploading",
      stagingKey: upload.key,
      uploadFilename: input.filename,
    });
    return { datasetId: dataset.id, slug: dataset.slug, uploadUrl: upload.url };
  }

  async writeStagedUpload(input: StagedUploadInput): Promise<void> {
    const storage = await this.storageResolver.forProject(input.projectId);
    if (!storage.putStaged) throw new DirectUploadUnavailableError();
    const key = stagingUploadKey(input.projectId, input.uploadId);
    if (
      !(await this.datasets.tryFindPendingUploadByStagingKey({
        projectId: input.projectId,
        stagingKey: key,
      }))
    )
      throw new UploadNotPendingError();
    await storage.putStaged({
      projectId: input.projectId,
      key,
      body: input.body as Readable,
      maxBytes: UPLOAD_MAX_BYTES,
    });
  }

  async abortPendingUpload(
    input: AbortPendingUploadInput,
  ): Promise<{ datasetId: string; aborted: true }> {
    const dataset = await this.findDataset(input.datasetId, input.projectId);
    if (dataset.status !== "uploading") throw new UploadNotPendingError();
    if (dataset.stagingKey)
      await this.storageResolver
        .forProject(input.projectId)
        .then((storage) =>
          storage.deleteStaged({ projectId: input.projectId, key: dataset.stagingKey! }),
        );
    await this.datasets.deletePendingUpload({
      id: input.datasetId,
      projectId: input.projectId,
    });
    return { datasetId: input.datasetId, aborted: true };
  }

  async finalizeUpload(
    input: FinalizeUploadInput,
  ): Promise<{ datasetId: string; status: "processing" }> {
    const dataset = await this.findDataset(input.datasetId, input.projectId);
    if (dataset.status !== "uploading" || !dataset.stagingKey) throw new UploadNotPendingError();
    const storage = await this.storageResolver.forProject(input.projectId);
    let size: number;
    try {
      size = await storage.headStagedObjectSize({
        projectId: input.projectId,
        key: dataset.stagingKey,
      });
    } catch (error) {
      if (error instanceof StagedUploadNotFoundError)
        await this.datasets.update({
          id: dataset.id,
          projectId: input.projectId,
          data: { status: "failed", stagingKey: null },
        });
      throw error;
    }
    if (exceedsUploadCap(size)) {
      await storage
        .deleteStaged({ projectId: input.projectId, key: dataset.stagingKey })
        .catch(() => undefined);
      await this.datasets.update({
        id: dataset.id,
        projectId: input.projectId,
        data: {
          status: "failed",
          stagingKey: null,
          statusError: "Uploaded file is too large",
        },
      });
      throw new UploadTooLargeError();
    }
    if (
      (await this.datasets.claimForProcessing({
        id: input.datasetId,
        projectId: input.projectId,
      })) === 0
    )
      throw new UploadNotPendingError();
    return { datasetId: input.datasetId, status: "processing" };
  }

  async retryNormalize(
    input: RetryNormalizeInput,
  ): Promise<{ datasetId: string; status: "processing" }> {
    const dataset = await this.findDataset(input.datasetId, input.projectId);
    if ((dataset.status !== "failed" && dataset.status !== "processing") || !dataset.stagingKey)
      throw new UploadNotPendingError("Dataset is not retryable");
    await this.datasets.update({
      id: dataset.id,
      projectId: input.projectId,
      data: { status: "processing", statusError: null },
    });
    return { datasetId: input.datasetId, status: "processing" };
  }

  private async findDataset(slugOrId: string, projectId: string): Promise<Dataset> {
    const dataset =
      (await this.datasets.tryFindOne({ id: slugOrId, projectId })) ??
      (await this.datasets.tryFindBySlug({ slug: slugOrId, projectId }));
    if (!dataset) throw new DatasetNotFoundError();
    return dataset;
  }

  private assertFile(filename: string, content: string, fileSize: number): void {
    if (fileSize > MAX_FILE_SIZE_BYTES)
      throw new UploadValidationError(
        "File size exceeds the maximum limit of 25MB",
        "file_too_large",
      );
    const { rows } = parseFileContent({ content, format: detectFileFormat(filename) });
    if (!rows.length) throw new UploadValidationError("File contains no data rows", "empty_file");
    if (rows.length > MAX_ROWS_LIMIT)
      throw new UploadValidationError(`File contains too many rows`, "row_limit_exceeded");
  }
}

function slugify(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replaceAll(/[^\p{L}\p{N}]+/gu, "-")
      .replaceAll(/^-+|-+$/g, "")
      .toLowerCase() || "dataset"
  );
}
