import {
  convertRowsToColumnTypes,
  datasetColumnsSchema,
  detectFileFormat,
  formatDatasetByteLimit,
  renameReservedColumns,
  type FileFormat,
  DatasetImportSourceRefusedError,
  DatasetNameTakenError,
  DatasetNotFoundError,
  UploadNotPendingError,
  UploadValidationError,
  type AppendStoredObjectToDatasetInput,
  type CreateDatasetFromStoredObjectInput,
  type CreateDatasetFromUploadInput,
  type CreateDatasetFromUploadResult,
  type DatasetImportAppended,
  type DatasetImportStarted,
  type DatasetLimits,
  type UploadExistingDatasetInput,
  type RetryNormalizeInput,
  type DatasetColumns,
} from "@langwatch/dataset-contract";
import { generate } from "@langwatch/ksuid";
import {
  DATASET_IMPORT_PURPOSE,
  StoredObjectNotFoundError,
  type StoredObjectApi,
  type StoredObjectMetadata,
} from "@langwatch/stored-object-contract";
import { nowInstant } from "@langwatch/time";

import type { DatasetUpload } from "../app/dataset.app.ts";
import type { DatasetChunkRepository } from "../repositories/dataset-chunk.repository.ts";
import type { DatasetContentRepository } from "../repositories/dataset-content.repository.ts";
import type { DatasetRecordContentRepository } from "../repositories/dataset-record-content.repository.ts";
import type { DatasetRow } from "../repositories/dataset.repository.ts";
import { onceMaxBytes } from "../rules/dataset-inline-file.rules.ts";
import {
  assertStoredRowWithinLimit,
  entryBytesOf,
  assertUploadFileWithinLimit,
} from "../rules/dataset-row-limits.rules.ts";
import { stripNullBytes } from "../rules/dataset-sanitize.rules.ts";
import { StreamingChunkWriterService } from "./dataset-chunk-writer.service.ts";
import { DatasetChunkService } from "./dataset-chunk.service.ts";
import { DatasetFileReaderService, type DatasetFileRow } from "./dataset-file-reader.service.ts";
import {
  type DatasetInlineAttachmentService,
  type InlineAttachmentScope,
} from "./dataset-inline-attachment.service.ts";
import type { DatasetRequestBoundsService } from "./dataset-request-bounds.service.ts";

const IMPORTABLE_FILENAME = /\.(csv|json|jsonl)$/i;

/**
 * The app's KSUID resource for a dataset row (`KSUID_RESOURCES.DATASET`).
 * The literal, not the constant table: `dataset_` is the prefix already
 * written to storage, so it belongs with the writer.
 */
const DATASET_KSUID_RESOURCE = "dataset";

type DatasetUploadServiceOptions = {
  datasets: DatasetContentRepository;
  records: DatasetRecordContentRepository;
  chunks: DatasetChunkRepository;
  storedObjects: StoredObjectApi;
  /** The limits the project's organization answers for this upload. */
  requestBounds: Pick<DatasetRequestBoundsService, "limits">;
  /** Stores the files a row carries inline and leaves their references. */
  inlineAttachments: Pick<DatasetInlineAttachmentService, "store">;
};

/** Owns upload lifecycle behavior; routes only see DatasetService's contract. */
export class DatasetUploadService implements DatasetUpload {
  static create(options: DatasetUploadServiceOptions): DatasetUploadService {
    return new DatasetUploadService(options);
  }
  private readonly chunks: DatasetChunkService;
  private readonly datasets: DatasetContentRepository;
  private readonly records: DatasetRecordContentRepository;
  private readonly storage: DatasetChunkRepository;
  private readonly storedObjects: StoredObjectApi;
  private readonly requestBounds: Pick<DatasetRequestBoundsService, "limits">;
  private readonly inlineAttachments: Pick<DatasetInlineAttachmentService, "store">;

  private constructor(options: DatasetUploadServiceOptions) {
    this.datasets = options.datasets;
    this.records = options.records;
    this.storage = options.chunks;
    this.storedObjects = options.storedObjects;
    this.requestBounds = options.requestBounds;
    this.inlineAttachments = options.inlineAttachments;
    this.chunks = DatasetChunkService.create({ datasets: options.datasets });
  }

  async uploadToExistingDataset(
    input: UploadExistingDatasetInput,
  ): Promise<{ datasetId: string; recordsCreated: number }> {
    const format = uploadFormatOf(input.filename);
    const limits = await this.requestBounds.limits(input.projectId);

    return this.appendRows({ ...input, format, limits });
  }

  /**
   * The file's rows appended in one write, so a file refused part way adds
   * nothing. Each row's inline files are stored as it is read, and what is
   * held until the write is the rows with their references.
   */
  private async appendRows(input: {
    slugOrId: string;
    projectId: string;
    bytes: AsyncIterable<Uint8Array>;
    format: FileFormat;
    limits: DatasetLimits;
  }): Promise<{ datasetId: string; recordsCreated: number }> {
    const { limits, projectId } = input;
    let dataset: DatasetRow | undefined;
    let columns: DatasetColumns = [];
    let scope: InlineAttachmentScope | undefined;
    const entries: Record<string, unknown>[] = [];
    let heldBytes = 0;

    for await (const row of this.readUpload({ ...input, limits })) {
      if (!dataset || !scope) {
        dataset = await this.findDataset(input.slugOrId, projectId);
        columns = datasetColumnsSchema.parse(dataset.columnTypes);
        assertSameColumns(row.headers, columns);
        scope = {
          projectId,
          datasetId: dataset.id,
          columns: { kind: "typed", columnTypes: columns },
          maxBytes: onceMaxBytes(() => Promise.resolve(limits.attachmentBytes)),
        };
      }
      const [converted] = convertRowsToColumnTypes([row.record], columns);
      const entry = await this.inlineAttachments.store(scope, converted ?? {});
      assertStoredRowWithinLimit(entry);
      heldBytes += entryBytesOf(entry);
      if (heldBytes > limits.wholeReadBytes) {
        throw new UploadValidationError(
          `The file's rows are larger than the ${formatDatasetByteLimit(limits.wholeReadBytes)} one upload adds to a dataset. ` +
            "Split the file, or put its files in image or file columns.",
          "file_too_large",
        );
      }
      entries.push(entry);
    }
    if (!dataset) throw new UploadValidationError("File contains no data rows", "empty_file");

    const stamped = entries.map((entry, index) => ({
      id: `${nowInstant().epochMilliseconds}-${index}`,
      entry,
    }));
    if (dataset.contentLayout === "s3_jsonl") {
      await this.chunks.append({
        dataset,
        projectId,
        entries: stamped.map(({ entry }) => entry),
        forcedIds: stamped.map(({ id }) => id),
        storage: this.storage,
      });
    } else {
      await this.records.createMany({
        records: stamped.map(({ id, entry }) => ({ id, entry: stripNullBytes(entry) })),
        datasetId: dataset.id,
        projectId,
      });
    }

    return { datasetId: dataset.id, recordsCreated: stamped.length };
  }

  /**
   * A new dataset written chunk by chunk as the file streams in: memory holds
   * one row and the chunk being filled, whatever the file's size.
   */
  async createDatasetFromUpload(
    input: CreateDatasetFromUploadInput,
  ): Promise<CreateDatasetFromUploadResult> {
    const format = uploadFormatOf(input.filename);
    const limits = await this.requestBounds.limits(input.projectId);
    const datasetId = generate(DATASET_KSUID_RESOURCE).toString();
    const writer = StreamingChunkWriterService.create({
      storage: this.storage,
      projectId: input.projectId,
      datasetId,
    });
    const pictureColumns = new Set<string>();
    const scope: InlineAttachmentScope = {
      projectId: input.projectId,
      datasetId,
      columns: { kind: "untyped", onPictureColumn: (column) => pictureColumns.add(column) },
      maxBytes: onceMaxBytes(() => Promise.resolve(limits.attachmentBytes)),
    };
    let names: string[] = [];
    let rename = new Map<string, string>();
    let stringColumns: DatasetColumns = [];

    try {
      for await (const row of this.readUpload({ bytes: input.bytes, format, limits })) {
        if (row.headers) {
          names = renameReservedColumns(row.headers);
          rename = new Map(row.headers.map((header, index) => [header, names[index]!]));
          stringColumns = names.map((name) => ({ name, type: "string" as const }));
        }
        const renamed = Object.fromEntries(
          Object.entries(row.record).map(([key, value]) => [rename.get(key) ?? key, value]),
        );
        const [converted] = convertRowsToColumnTypes([renamed], stringColumns);
        const entry = await this.inlineAttachments.store(scope, converted ?? {});
        assertStoredRowWithinLimit(entry);
        await writer.push(stripNullBytes(entry) as typeof entry);
      }
      const written = await writer.finalize();
      if (written.rowCount === 0) {
        throw new UploadValidationError("File contains no data rows", "empty_file");
      }
      const columnTypes: DatasetColumns = names.map((name) => ({
        name,
        type: pictureColumns.has(name) ? ("image" as const) : ("string" as const),
      }));
      const dataset = await this.datasets.create({
        id: datasetId,
        projectId: input.projectId,
        name: input.name,
        slug: slugify(input.name),
        columnTypes,
        contentLayout: "s3_jsonl",
        status: "ready",
        rowCount: written.rowCount,
        sizeBytes: BigInt(written.sizeBytes),
        chunkCount: written.chunkCount,
        chunkOffsets: written.chunkOffsets,
      });

      return {
        id: dataset.id,
        name: dataset.name,
        slug: dataset.slug,
        columnTypes: dataset.columnTypes as DatasetColumns,
        createdAt: dataset.createdAt,
        updatedAt: dataset.updatedAt,
        recordsCreated: written.rowCount,
      };
    } catch (error) {
      await this.discardChunks(input.projectId, datasetId);
      throw error;
    }
  }

  /** Best-effort: a failed reap must not hide the refusal that caused it. */
  private async discardChunks(projectId: string, datasetId: string): Promise<void> {
    try {
      await this.storage.deleteChunksFrom({ projectId, datasetId, fromIndex: 0 });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
    }
  }

  async createDatasetFromStoredObject(
    input: CreateDatasetFromStoredObjectInput,
  ): Promise<DatasetImportStarted> {
    const source = await this.getImportSource(input);
    const limits = await this.requestBounds.limits(input.projectId);
    assertUploadFileWithinLimit(source.byteLength, limits.fileBytes);
    const slug = slugify(input.name);
    if (await this.datasets.findBySlug({ projectId: input.projectId, slug }))
      throw new DatasetNameTakenError();
    const dataset = await this.datasets.create({
      id: generate(DATASET_KSUID_RESOURCE).toString(),
      projectId: input.projectId,
      name: input.name,
      slug,
      columnTypes: input.columnTypes ?? [],
      contentLayout: "s3_jsonl",
      status: "processing",
      uploadFilename: source.filename,
      sourceStoredObjectId: input.storedObjectId,
    });
    return { datasetId: dataset.id, slug: dataset.slug, status: "processing" };
  }

  /** Synchronous, and held to the size of one upload call (ADR-158 §6). */
  async appendStoredObjectToDataset(
    input: AppendStoredObjectToDatasetInput,
  ): Promise<DatasetImportAppended> {
    const source = await this.getImportSource(input);
    const limits = await this.requestBounds.limits(input.projectId);
    assertUploadFileWithinLimit(source.byteLength, limits.fileBytes);
    const { bytes } = await this.storedObjects.getById({
      projectId: input.projectId,
      id: input.storedObjectId,
    });

    return this.appendRows({
      slugOrId: input.slugOrId,
      projectId: input.projectId,
      bytes,
      format: uploadFormatOf(source.filename),
      limits,
    });
  }

  async retryNormalize(
    input: RetryNormalizeInput,
  ): Promise<{ datasetId: string; status: "processing" }> {
    const dataset = await this.findDataset(input.datasetId, input.projectId);
    if (
      (dataset.status !== "failed" && dataset.status !== "processing") ||
      (!dataset.sourceStoredObjectId && !dataset.stagingKey)
    )
      throw new UploadNotPendingError("Dataset is not retryable");
    await this.datasets.update({
      id: dataset.id,
      projectId: input.projectId,
      data: { status: "processing", statusError: null },
    });
    return { datasetId: input.datasetId, status: "processing" };
  }

  /** The confirmed `dataset_import` file in this project, named as a readable format. */
  private async getImportSource(input: {
    projectId: string;
    storedObjectId: string;
  }): Promise<StoredObjectMetadata & { filename: string }> {
    let metadata: StoredObjectMetadata;
    try {
      metadata = await this.storedObjects.getMetadata({
        projectId: input.projectId,
        id: input.storedObjectId,
      });
    } catch (error) {
      if (error instanceof StoredObjectNotFoundError)
        throw new DatasetImportSourceRefusedError("not_found");
      throw error;
    }
    if (metadata.projectId !== input.projectId)
      throw new DatasetImportSourceRefusedError("not_found");
    if (metadata.status !== "available") throw new DatasetImportSourceRefusedError("not_confirmed");
    if (metadata.provenance.purpose !== DATASET_IMPORT_PURPOSE)
      throw new DatasetImportSourceRefusedError("wrong_purpose");
    if (!IMPORTABLE_FILENAME.test(metadata.filename))
      throw new DatasetImportSourceRefusedError("unsupported_format");
    return metadata;
  }

  private async findDataset(slugOrId: string, projectId: string): Promise<DatasetRow> {
    const dataset =
      (await this.datasets.findOne({ id: slugOrId, projectId })) ??
      (await this.datasets.findBySlug({ slug: slugOrId, projectId }));
    if (!dataset) throw new DatasetNotFoundError();
    return dataset;
  }

  /**
   * The upload gate, row by row as the file streams in: the size limits count
   * the bytes that arrive, never the size the client stated, and the row limit
   * stops the read. Every data row carries the file's headers on the first one.
   */
  private async *readUpload(input: {
    bytes: AsyncIterable<Uint8Array>;
    format: FileFormat;
    limits: DatasetLimits;
  }): AsyncGenerator<DatasetFileRow> {
    const reader = DatasetFileReaderService.create({
      rowBytes: input.limits.rowBytes,
      jsonFileBytes: input.limits.jsonFileBytes,
      fileBytes: input.limits.fileBytes,
      rowsMax: input.limits.rowsMax,
    });
    let headers: string[] | undefined;
    let announced = false;
    let rows = 0;
    for await (const row of reader.rows({ bytes: input.bytes, format: input.format })) {
      if (row.headers) {
        headers = row.headers;
        continue;
      }
      headers ??= Object.keys(row.record);
      rows += 1;
      yield announced ? { record: row.record } : { headers, record: row.record };
      announced = true;
    }
    if (rows === 0) throw new UploadValidationError("File contains no data rows", "empty_file");
  }
}

/** Refuses a file whose columns are not exactly the dataset's. */
function assertSameColumns(headers: string[] | undefined, columns: DatasetColumns): void {
  const expected = new Set(columns.map((column) => column.name));
  const uploaded = new Set(headers ?? []);
  const unknown = [...uploaded].filter((header) => !expected.has(header));
  const absent = [...expected].filter((column) => !uploaded.has(column));
  if (unknown.length || absent.length) {
    throw new UploadValidationError(
      "Uploaded columns do not match the dataset schema",
      "column_mismatch",
    );
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

function uploadFormatOf(filename: string): FileFormat {
  if (!IMPORTABLE_FILENAME.test(filename)) {
    const extension = filename.split(".").pop()?.toLowerCase() ?? "unknown";
    throw new UploadValidationError(
      `Unsupported file format: .${extension}. Supported formats: .csv, .json, .jsonl`,
      "unsupported_format",
    );
  }
  return detectFileFormat(filename);
}
