import readline from "node:readline";
import { pipeline, Readable } from "node:stream";

import {
  convertRowsToColumnTypes,
  datasetColumnsSchema,
  dedupeHeaders,
  detectFileFormat,
  MAX_FILE_SIZE_BYTES,
  MAX_ROWS_LIMIT,
  parseJSON,
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
import Papa from "papaparse";

import type { DatasetUpload } from "../app/dataset.app.ts";
import type { DatasetChunkRepository } from "../repositories/dataset-chunk.repository.ts";
import type { DatasetContentRepository } from "../repositories/dataset-content.repository.ts";
import type { DatasetRecordContentRepository } from "../repositories/dataset-record-content.repository.ts";
import type { DatasetRow } from "../repositories/dataset.repository.ts";
import { stripNullBytes } from "../rules/dataset-sanitize.rules.ts";
import { DatasetChunkService } from "./dataset-chunk.service.ts";

const IMPORTABLE_FILENAME = /\.(csv|json|jsonl)$/i;

/**
 * The app's KSUID resource for a dataset row (`KSUID_RESOURCES.DATASET`).
 * The literal, not the constant table: `dataset_` is the prefix already
 * written to storage, so it belongs with the writer.
 */
const DATASET_KSUID_RESOURCE = "dataset";

/** Owns upload lifecycle behavior; routes only see DatasetService's contract. */
export class DatasetUploadService implements DatasetUpload {
  static create(options: {
    datasets: DatasetContentRepository;
    records: DatasetRecordContentRepository;
    chunks: DatasetChunkRepository;
    storedObjects: StoredObjectApi;
  }): DatasetUploadService {
    return new DatasetUploadService(options);
  }
  private readonly chunks: DatasetChunkService;
  private readonly datasets: DatasetContentRepository;
  private readonly records: DatasetRecordContentRepository;
  private readonly storage: DatasetChunkRepository;
  private readonly storedObjects: StoredObjectApi;

  private constructor(options: {
    datasets: DatasetContentRepository;
    records: DatasetRecordContentRepository;
    chunks: DatasetChunkRepository;
    storedObjects: StoredObjectApi;
  }) {
    this.datasets = options.datasets;
    this.records = options.records;
    this.storage = options.chunks;
    this.storedObjects = options.storedObjects;
    this.chunks = DatasetChunkService.create({ datasets: options.datasets });
  }

  async uploadToExistingDataset(
    input: UploadExistingDatasetInput,
  ): Promise<{ datasetId: string; recordsCreated: number }> {
    const { headers, rows } = await this.readUpload(input);
    const dataset = await this.findDataset(input.slugOrId, input.projectId);
    const expected = new Set(
      (dataset.columnTypes as { name: string }[]).map((column) => column.name),
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
      id: `${nowInstant().epochMilliseconds}-${index}`,
      ...entry,
    }));
    if (dataset.contentLayout === "s3_jsonl") {
      await this.chunks.append({
        dataset,
        projectId: input.projectId,
        entries: entries.map(({ id: _id, ...entry }) => entry),
        forcedIds: entries.map((entry) => entry.id),
        storage: this.storage,
      });
    } else {
      await this.records.createMany({
        records: entries.map(({ id, ...entry }) => ({
          id,
          entry: stripNullBytes(entry),
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
    const { headers, rows } = await this.readUpload(input);
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
    const datasetId = generate(DATASET_KSUID_RESOURCE).toString();
    const initial = await this.chunks.writeInitialChunks({
      projectId: input.projectId,
      datasetId,
      entries,
      forcedIds: entries.map(() => undefined),
      storage: this.storage,
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
      chunkOffsets: initial.chunkOffsets,
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

  async createDatasetFromStoredObject(
    input: CreateDatasetFromStoredObjectInput,
  ): Promise<DatasetImportStarted> {
    const source = await this.getImportSource(input);
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

  /** Synchronous and capped at the multipart limit, as main's append was (ADR-158 §6). */
  async appendStoredObjectToDataset(
    input: AppendStoredObjectToDatasetInput,
  ): Promise<DatasetImportAppended> {
    const source = await this.getImportSource(input);
    if (source.byteLength > MAX_FILE_SIZE_BYTES)
      throw new UploadValidationError(
        "File size exceeds the maximum limit of 25MB",
        "file_too_large",
      );
    const { bytes } = await this.storedObjects.getById({
      projectId: input.projectId,
      id: input.storedObjectId,
    });
    return this.uploadToExistingDataset({
      slugOrId: input.slugOrId,
      projectId: input.projectId,
      filename: source.filename,
      bytes,
      fileSize: source.byteLength,
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
   * The upload gate, row by row as the file streams in: the size bound counts the
   * bytes that arrive, never the client-stated `fileSize`, and the row cap stops the read.
   */
  private async readUpload(input: {
    filename: string;
    bytes: AsyncIterable<Uint8Array>;
  }): Promise<{ headers: string[]; rows: Record<string, unknown>[] }> {
    const format = uploadFormatOf(input.filename);
    let headers: string[] = [];
    const rows: Record<string, unknown>[] = [];
    for await (const row of readRows(boundedBytes(input.bytes), format)) {
      if (rows.length === 0 && format !== "csv") headers = Object.keys(row.record);
      if (row.headers) headers = row.headers;
      else rows.push(row.record);
      if (rows.length > MAX_ROWS_LIMIT)
        throw new UploadValidationError(`File contains too many rows`, "row_limit_exceeded");
    }
    if (!rows.length) throw new UploadValidationError("File contains no data rows", "empty_file");
    return { headers, rows };
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

/** The body as it arrives, refused once it passes the upload limit rather than read to the end. */
async function* boundedBytes(body: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
  let seen = 0;
  for await (const part of body) {
    seen += part.byteLength;
    if (seen > MAX_FILE_SIZE_BYTES)
      throw new UploadValidationError(
        "File size exceeds the maximum limit of 25MB",
        "file_too_large",
      );
    yield part;
  }
}

type UploadedRow = { headers?: string[]; record: Record<string, unknown> };

/** One record at a time; a `.json` array (or a `.jsonl` holding one) is read whole. */
async function* readRows(
  body: AsyncIterable<Uint8Array>,
  format: FileFormat,
): AsyncGenerator<UploadedRow> {
  if (format === "csv") {
    yield* readCsvRows(body);
    return;
  }
  const lines = readline.createInterface({ input: Readable.from(body), crlfDelay: Infinity });
  let first = true;
  for await (const rawLine of lines) {
    const line = withoutNullBytes(rawLine).trim();
    if (line === "") continue;
    if (format === "json" || (first && line.startsWith("["))) {
      yield* readJsonArray(line, lines);
      return;
    }
    first = false;
    yield { record: JSON.parse(line) as Record<string, unknown> };
  }
}

async function* readJsonArray(
  firstLine: string,
  rest: AsyncIterable<string>,
): AsyncGenerator<UploadedRow> {
  const parts = [firstLine];
  for await (const line of rest) parts.push(withoutNullBytes(line));
  for (const record of parseJSON(parts.join("\n"))) yield { record };
}

/** Rows as arrays mapped by index, the header row deduplicated once, as normalize does. */
async function* readCsvRows(body: AsyncIterable<Uint8Array>): AsyncGenerator<UploadedRow> {
  const parsed = pipeline(
    Readable.from(body),
    Papa.parse(Papa.NODE_STREAM_INPUT, { header: false, skipEmptyLines: true }),
    () => undefined,
  );
  let headers: string[] | undefined;
  for await (const values of parsed) {
    const cells = (Array.isArray(values) ? values : []).map((value) =>
      withoutNullBytes(value == null ? "" : String(value)),
    );
    if (headers) {
      yield { record: Object.fromEntries(headers.map((header, i) => [header, cells[i]])) };
    } else {
      headers = dedupeHeaders(cells);
      yield { headers, record: {} };
    }
  }
}

function withoutNullBytes(text: string): string {
  return text.includes("\u0000") ? text.replaceAll("\u0000", "") : text;
}
