import type { DatasetLimits } from "@langwatch/dataset-contract";
import {
  storedObjectMetadataSchema,
  type StoredObjectApi,
} from "@langwatch/stored-object-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
/**
 * @vitest-environment node
 * What an uploaded file BECOMES: rows parsed from CSV/JSONL/JSON array,
 * coerced to declared column types. Repositories/storage are fakes here.
 */
import { describe, expect, it } from "vitest";

import {
  createDatasetTestInlineAttachments,
  createDatasetTestRequestBoundsWith,
} from "../../app/__tests__/dataset.fixture.ts";
import type { DatasetChunkRepository } from "../../repositories/dataset-chunk.repository.ts";
import type {
  CreateDatasetInput,
  UpdateDatasetInput,
} from "../../repositories/dataset-content.repository.ts";
import type { DatasetRecordContentRepository } from "../../repositories/dataset-record-content.repository.ts";
import type { DatasetRow } from "../../repositories/dataset.repository.ts";
import { MemoryDatasetContentRepository } from "../../repositories/memory/memory.dataset-content.repository.ts";
import { MemoryDatasetDatabase } from "../../repositories/memory/memory.dataset.database.ts";
import { DatasetUploadService } from "../dataset-upload.service.ts";

const PROJECT_ID = "project-1";
const PNG_INLINE = `data:image/png;base64,${Buffer.from("89504e470d0a1a0a0000000d49484452", "hex").toString("base64")}`;
const NULL_BYTE = String.fromCharCode(0);

type WrittenRecord = { id: string; entry: unknown };

function writtenRecord(line: unknown): WrittenRecord {
  if (typeof line !== "object" || line === null || !("id" in line) || !("entry" in line)) {
    throw new Error("storage received a line that is not an { id, entry } record");
  }
  return { id: String(line.id), entry: line.entry };
}

const unwired = (member: string) => () => {
  throw new Error(`storage.${member} is not wired in this test`);
};

function datasetRow(overrides: Partial<DatasetRow> = {}): DatasetRow {
  return {
    id: "dataset_abc123",
    projectId: PROJECT_ID,
    name: "User Feedback",
    slug: "user-feedback",
    columnTypes: [
      { name: "input", type: "string" },
      { name: "output", type: "string" },
    ],
    createdAt: new Date(0),
    updatedAt: new Date(0),
    archivedAt: null,
    mapping: null,
    useS3: false,
    s3RecordCount: null,
    contentLayout: "inline",
    status: "ready",
    statusError: null,
    stagingKey: null,
    sourceStoredObjectId: null,
    uploadFilename: null,
    rowCount: null,
    sizeBytes: null,
    chunkCount: null,
    chunkOffsets: null,
    ...overrides,
  };
}

/**
 * The two repositories and the storage, as fakes that record what the adapter
 * asked them to persist. `writeChunks` may be made to fail, which is how the
 * "storage is unavailable" cases are expressed.
 */
function harness({
  row = null,
  storageFails = false,
  limits = {},
  importBytes = 1024,
}: {
  row?: DatasetRow | null;
  storageFails?: boolean;
  limits?: Partial<DatasetLimits>;
  /** The size the import file's stored object records. */
  importBytes?: number;
} = {}) {
  const storedFiles: { mediaType: string | undefined; filename: string }[] = [];
  const sourceReads: string[] = [];
  const storedObjects = createApiFixture<StoredObjectApi>(
    {
      getMetadata: async ({ projectId, id }) => {
        sourceReads.push("metadata");
        return storedObjectMetadataSchema.parse({
          projectId,
          id,
          sha256: "a".repeat(64),
          byteLength: importBytes,
          mediaType: "application/x-ndjson",
          filename: "rows.jsonl",
          mediaTypeVerified: true,
          status: "available",
          audiences: [],
          generation: 1,
          provenance: { purpose: "dataset_import", ownerKind: "project", ownerId: projectId },
          createdAt: "2026-09-24T00:00:00.000Z",
        });
      },
      getById: async () => {
        sourceReads.push("bytes");
        throw new Error("the import file is read only when it is within the limit");
      },
      storeFromBytes: async (input) => {
        storedFiles.push({ mediaType: input.mediaType, filename: input.filename });
        return {
          isDuplicate: false,
          reference: {
            projectId: input.projectId,
            id: `object-${storedFiles.length}`,
            sha256: "a".repeat(64),
            byteLength: 16,
            filename: input.filename,
            mediaType: input.mediaType,
            audience: input.audience,
          },
        };
      },
    },
    "storedObjects",
  );
  const requestBounds = createDatasetTestRequestBoundsWith(limits);
  const created: CreateDatasetInput[] = [];
  const inlineRecords: WrittenRecord[] = [];
  const chunkLines: WrittenRecord[] = [];
  let failing = storageFails;

  const updated: UpdateDatasetInput[] = [];
  const database = MemoryDatasetDatabase.create();
  const stored = MemoryDatasetContentRepository.create({ database });
  const datasets = Object.assign(MemoryDatasetContentRepository.create({ database }), {
    findOne: async ({ id }: { id: string; projectId: string }) =>
      row && row.id === id ? row : null,
    findBySlug: async ({ slug }: { slug: string; projectId: string }) =>
      row && row.slug === slug ? row : null,
    create: async (input: CreateDatasetInput) => {
      created.push(input);
      return stored.create(input);
    },
    update: async (input: UpdateDatasetInput) => {
      updated.push(input);
      return datasetRow();
    },
  });

  const records: DatasetRecordContentRepository = {
    createMany: async ({ records: written, datasetId, projectId }) => {
      inlineRecords.push(...written);
      return written.map(({ id }) => ({
        id,
        datasetId,
        projectId,
        entry: {},
        createdAt: new Date(0),
        updatedAt: new Date(0),
      }));
    },
  };

  const storageError = new Error("object storage is unavailable");
  const storage: DatasetChunkRepository = {
    writeChunks: async ({ records: lines }) => {
      if (failing) throw storageError;
      chunkLines.push(...lines.map(writtenRecord));
      return [
        {
          index: 0,
          jsonl: "",
          rowCount: lines.length,
          byteSize: lines.length * 10,
          startRow: 0,
          endRow: lines.length,
        },
      ];
    },
    deleteChunksFrom: async () => undefined,
    readChunks: unwired("readChunks"),
    readChunk: unwired("readChunk"),
    rewriteChunk: unwired("rewriteChunk"),
    readStagedUpload: unwired("readStagedUpload"),
    removeStagedUpload: unwired("removeStagedUpload"),
  };

  return {
    adapter: DatasetUploadService.create({
      datasets,
      records,
      chunks: storage,
      storedObjects,
      requestBounds,
      inlineAttachments: createDatasetTestInlineAttachments(storedObjects, requestBounds),
    }),
    storedFiles,
    sourceReads,
    created,
    updated,
    inlineRecords,
    chunkLines,
    storageError,
    restoreStorage: () => {
      failing = false;
    },
  };
}

/** The file as a multipart body arrives: in pieces, never one string. */
async function* bytesOf(content: string): AsyncGenerator<Uint8Array> {
  const whole = Buffer.from(content, "utf8");
  for (let at = 0; at < whole.byteLength; at += 64 * 1024) yield whole.subarray(at, at + 64 * 1024);
}

const upload = (
  adapter: DatasetUploadService,
  { slugOrId, filename, content }: { slugOrId: string; filename: string; content: string },
) =>
  adapter.uploadToExistingDataset({
    slugOrId,
    projectId: PROJECT_ID,
    filename,
    bytes: bytesOf(content),
    fileSize: Buffer.byteLength(content, "utf8"),
  });

const create = (
  adapter: DatasetUploadService,
  input: { name: string; filename: string; content: string },
) =>
  adapter.createDatasetFromUpload({
    projectId: PROJECT_ID,
    name: input.name,
    filename: input.filename,
    bytes: bytesOf(input.content),
    fileSize: Buffer.byteLength(input.content, "utf8"),
  });

describe("DatasetUploadService", () => {
  describe("given a dataset that already exists", () => {
    describe("when a file is uploaded into it", () => {
      /** @scenario "Upload a CSV file to an existing dataset" */
      it("turns each CSV data row into a record carrying the uploaded values", async () => {
        const { adapter, inlineRecords } = harness({ row: datasetRow() });

        const result = await upload(adapter, {
          slugOrId: "user-feedback",
          filename: "feedback.csv",
          content: "input,output\nhello,Hi there!\ngoodbye,See you later!\n",
        });

        expect(result).toMatchObject({ datasetId: "dataset_abc123", recordsCreated: 2 });
        expect(inlineRecords.map((record) => record.entry)).toEqual([
          { input: "hello", output: "Hi there!" },
          { input: "goodbye", output: "See you later!" },
        ]);
      });

      /** @scenario "Upload a JSONL file to an existing dataset" */
      it("reads one record per JSONL line", async () => {
        const row = datasetRow({
          slug: "logs",
          columnTypes: [
            { name: "message", type: "string" },
            { name: "level", type: "string" },
          ],
        });
        const { adapter, inlineRecords } = harness({ row });

        const result = await upload(adapter, {
          slugOrId: "logs",
          filename: "logs.jsonl",
          content:
            '{"message": "started", "level": "info"}\n{"message": "crashed", "level": "error"}\n',
        });

        expect(result.recordsCreated).toBe(2);
        expect(inlineRecords.map((record) => record.entry)).toEqual([
          { message: "started", level: "info" },
          { message: "crashed", level: "error" },
        ]);
      });

      /** @scenario "Upload a JSON array file to an existing dataset" */
      it("reads every object of a JSON array", async () => {
        const row = datasetRow({
          slug: "items",
          columnTypes: [
            { name: "name", type: "string" },
            { name: "price", type: "number" },
          ],
        });
        const { adapter, inlineRecords } = harness({ row });

        const result = await upload(adapter, {
          slugOrId: "items",
          filename: "items.json",
          content: JSON.stringify([
            { name: "a", price: "1" },
            { name: "b", price: "2" },
            { name: "c", price: "3" },
          ]),
        });

        expect(result.recordsCreated).toBe(3);
        expect(inlineRecords).toHaveLength(3);
      });

      /** @scenario "Upload converts values to match column types" */
      it("coerces the file's strings into the types the dataset declares", async () => {
        const row = datasetRow({
          slug: "typed",
          columnTypes: [
            { name: "count", type: "number" },
            { name: "active", type: "boolean" },
            { name: "created", type: "date" },
          ],
        });
        const { adapter, inlineRecords } = harness({ row });

        await upload(adapter, {
          slugOrId: "typed",
          filename: "typed.csv",
          content: "count,active,created\n42,true,2026-01-15T10:00:00.000Z\n",
        });

        expect(inlineRecords[0]?.entry).toEqual({
          count: 42,
          active: true,
          created: "2026-01-15",
        });
      });

      /** @scenario "Upload to dataset referenced by ID" */
      it("finds the dataset by id when the path carried an id", async () => {
        const { adapter, inlineRecords } = harness({ row: datasetRow() });

        const result = await upload(adapter, {
          slugOrId: "dataset_abc123",
          filename: "feedback.csv",
          content: "input,output\nhello,world\n",
        });

        expect(result.datasetId).toBe("dataset_abc123");
        expect(inlineRecords).toHaveLength(1);
      });

      /** @scenario "Upload to existing dataset accepts a CSV containing null bytes" */
      it("scrubs a null byte out of a cell rather than failing the write", async () => {
        const row = datasetRow({
          slug: "feedback",
          columnTypes: [{ name: "input", type: "string" }],
        });
        const { adapter, inlineRecords } = harness({ row });

        const result = await upload(adapter, {
          slugOrId: "feedback",
          filename: "feedback.csv",
          content: `input\nhel${NULL_BYTE}lo\n`,
        });

        expect(result.recordsCreated).toBe(1);
        expect(inlineRecords[0]?.entry).toEqual({ input: "hello" });
      });
    });

    describe("when the uploaded file describes different columns", () => {
      /** @scenario "Upload fails when file columns do not match dataset columns" */
      it("refuses the upload as a column mismatch", async () => {
        const row = datasetRow({
          slug: "strict",
          columnTypes: [{ name: "input", type: "string" }],
        });
        const { adapter, inlineRecords } = harness({ row });

        await expect(
          upload(adapter, {
            slugOrId: "strict",
            filename: "other.csv",
            content: "question,answer\nwhat,that\n",
          }),
        ).rejects.toMatchObject({
          name: "UploadValidationError",
          kind: "column_mismatch",
          code: "validation_error",
          httpStatus: 400,
        });
        expect(inlineRecords).toHaveLength(0);
      });
    });

    describe("when the file carries no data rows", () => {
      /** @scenario "Upload an empty file returns 422" */
      it("refuses it as empty before any dataset is read", async () => {
        const { adapter } = harness({ row: datasetRow() });

        await expect(
          upload(adapter, {
            slugOrId: "user-feedback",
            filename: "feedback.csv",
            content: "input,output\n",
          }),
        ).rejects.toMatchObject({
          name: "UploadValidationError",
          kind: "empty_file",
          code: "validation_error",
          httpStatus: 422,
        });
      });
    });

    describe("when the file is larger than the organization's upload limit", () => {
      /** @scenario "Upload exceeding file size limit is rejected" */
      /** @scenario "An uploaded file larger than the file limit is refused naming the limit" */
      it("refuses it on the bytes the content carries, not the size the client stated", async () => {
        const { adapter, inlineRecords } = harness({
          row: datasetRow(),
          limits: { fileBytes: 256 * 1024 },
        });

        // The client understates the size to zero; the refusal still lands,
        // because the bound is measured as the content arrives.
        const rows = Array.from({ length: 30_000 }, (_, i) => `${i},row ${i}`).join("\n");
        await expect(
          adapter.uploadToExistingDataset({
            slugOrId: "user-feedback",
            projectId: PROJECT_ID,
            filename: "feedback.csv",
            bytes: bytesOf(`input,output\n${rows}\n`),
            fileSize: 0,
          }),
        ).rejects.toMatchObject({
          name: "UploadValidationError",
          kind: "file_too_large",
          httpStatus: 400,
          message: expect.stringContaining("256 KB"),
        });
        expect(inlineRecords).toHaveLength(0);
      });

      it("accepts a file whose client-stated size overshoots the measured one", async () => {
        const { adapter } = harness({ row: datasetRow(), limits: { fileBytes: 256 * 1024 } });

        // The reverse lie must not refuse either: the measured bytes decide,
        // and they sit well under the limit.
        await expect(
          adapter.uploadToExistingDataset({
            slugOrId: "user-feedback",
            projectId: PROJECT_ID,
            filename: "feedback.csv",
            bytes: bytesOf("input,output\nhello,world\n"),
            fileSize: 512 * 1024,
          }),
        ).resolves.toMatchObject({ recordsCreated: 1 });
      });
    });

    describe("when the file carries more rows than the organization's row count limit", () => {
      /** @scenario "Upload exceeding row limit is rejected" */
      /** @scenario "An uploaded file with more rows than the row count limit is refused naming the limit" */
      it("refuses it on the parsed row count", async () => {
        const { adapter, inlineRecords } = harness({
          row: datasetRow(),
          limits: { rowsMax: 1_000 },
        });
        const rows = Array.from({ length: 1_001 }, (_, i) => `${i},row ${i}`).join("\n");

        await expect(
          adapter.uploadToExistingDataset({
            slugOrId: "user-feedback",
            projectId: PROJECT_ID,
            filename: "feedback.csv",
            bytes: bytesOf(`input,output\n${rows}\n`),
            fileSize: 0,
          }),
        ).rejects.toMatchObject({
          name: "UploadValidationError",
          kind: "row_limit_exceeded",
          httpStatus: 400,
          message: expect.stringContaining("1,000"),
        });
        expect(inlineRecords).toHaveLength(0);
      });

      it("accepts more rows than the limit of the earlier release under the default limits", async () => {
        const { adapter } = harness({ row: datasetRow() });
        const rows = Array.from({ length: 10_001 }, (_, i) => `${i},row ${i}`).join("\n");

        await expect(
          upload(adapter, {
            slugOrId: "user-feedback",
            filename: "feedback.csv",
            content: `input,output\n${rows}\n`,
          }),
        ).resolves.toMatchObject({ recordsCreated: 10_001 });
      });
    });

    describe("when a row holds a picture written inline as base64", () => {
      /** @scenario "An uploaded file with inline pictures stores each picture and keeps its reference" */
      it("stores the picture of an image column and keeps its reference in the row", async () => {
        const { adapter, inlineRecords, storedFiles } = harness({
          row: datasetRow({
            columnTypes: [
              { name: "input", type: "string" },
              { name: "scan", type: "image" },
            ],
          }),
        });

        await upload(adapter, {
          slugOrId: "user-feedback",
          filename: "scans.jsonl",
          content: `${JSON.stringify({ input: "first", scan: PNG_INLINE })}\n${JSON.stringify({ input: "second", scan: PNG_INLINE })}\n`,
        });

        expect(storedFiles).toEqual([
          { mediaType: "image/png", filename: "scan.png" },
          { mediaType: "image/png", filename: "scan.png" },
        ]);
        expect(inlineRecords.map((record) => record.entry)).toEqual([
          { input: "first", scan: `/api/files/${PROJECT_ID}/object-1/scan.png` },
          { input: "second", scan: `/api/files/${PROJECT_ID}/object-2/scan.png` },
        ]);
      });
    });

    describe("when a row is larger than the organization's row limit", () => {
      /** @scenario "An uploaded row larger than the row limit is refused naming the limit" */
      it("refuses the upload with the row refusal and writes nothing", async () => {
        const { adapter, inlineRecords } = harness({
          row: datasetRow(),
          limits: { rowBytes: 64 * 1024 },
        });

        await expect(
          upload(adapter, {
            slugOrId: "user-feedback",
            filename: "feedback.jsonl",
            content: `${JSON.stringify({ input: "ok", output: "ok" })}\n${JSON.stringify({ input: "x".repeat(128 * 1024), output: "big" })}\n`,
          }),
        ).rejects.toMatchObject({
          code: "dataset_row_too_large",
          httpStatus: 413,
          meta: { maxBytes: 64 * 1024, measure: "uploaded" },
        });
        expect(inlineRecords).toHaveLength(0);
      });
    });

    describe("when the dataset the path names does not exist", () => {
      /** @scenario "Upload to a non-existent dataset returns 404" */
      it("refuses rather than creating one on the way past", async () => {
        const { adapter } = harness({ row: null });

        await expect(
          upload(adapter, {
            slugOrId: "does-not-exist",
            filename: "feedback.csv",
            content: "input\nhello\n",
          }),
        ).rejects.toMatchObject({
          name: "DatasetNotFoundError",
          code: "dataset_not_found",
          httpStatus: 404,
        });
      });
    });
  });

  describe("given no dataset yet", () => {
    describe("when a file is uploaded as a new dataset", () => {
      /**
       * @scenario "Create a new dataset from an uploaded CSV file"
       * @scenario "Create + upload infers column types as string by default"
       * @scenario "A new dataset is created directly in object storage"
       */
      it("makes the dataset the name slugifies to, with every header a string column", async () => {
        const { adapter, created } = harness();

        const result = await create(adapter, {
          name: "From CSV",
          filename: "questions.csv",
          content: "question,answer\nWhat is 2+2?,4\nCapital of UK?,London\n",
        });

        expect(result).toMatchObject({ name: "From CSV", slug: "from-csv", recordsCreated: 2 });
        expect(created[0]).toMatchObject({
          name: "From CSV",
          slug: "from-csv",
          columnTypes: [
            { name: "question", type: "string" },
            { name: "answer", type: "string" },
          ],
        });
      });

      /** @scenario "Create a new dataset from a JSONL file" */
      it("infers the columns from the JSONL keys", async () => {
        const { adapter, created } = harness();

        const result = await create(adapter, {
          name: "Logs",
          filename: "logs.jsonl",
          content:
            '{"message": "started", "level": "info"}\n{"message": "crashed", "level": "error"}\n',
        });

        expect(result).toMatchObject({ name: "Logs", recordsCreated: 2 });
        expect(created[0]).toMatchObject({
          columnTypes: [
            { name: "message", type: "string" },
            { name: "level", type: "string" },
          ],
        });
      });

      /** @scenario "Create + upload renames reserved column names" */
      it("moves the reserved header names aside and writes the rows under the new ones", async () => {
        const { adapter, created, chunkLines } = harness();

        await create(adapter, {
          name: "Reserved",
          filename: "reserved.csv",
          content: "id,input,selected\n1,hello,yes\n",
        });

        expect(created[0]).toMatchObject({
          columnTypes: [
            { name: "id_", type: "string" },
            { name: "input", type: "string" },
            { name: "selected_", type: "string" },
          ],
        });
        expect(chunkLines[0]?.entry).toEqual({ id_: "1", input: "hello", selected_: "yes" });
      });

      /** @scenario "Create + upload accepts a JSONL file containing a null byte in a string field" */
      it("scrubs a null byte out of a JSONL field rather than failing the create", async () => {
        const { adapter, chunkLines } = harness();

        const result = await create(adapter, {
          name: "With Nulls",
          filename: "nulls.jsonl",
          content: '{"reference": "a\\u0000b"}\n{"reference": "clean"}\n',
        });

        expect(result.recordsCreated).toBe(2);
        expect(chunkLines.map((line) => line.entry)).toEqual([
          { reference: "ab" },
          { reference: "clean" },
        ]);
      });
    });

    describe("when object storage is unavailable", () => {
      /** @scenario "A failed dataset create writes no orphan row" */
      it("fails the create and leaves no dataset behind", async () => {
        const { adapter, created, storageError } = harness({ storageFails: true });

        await expect(
          create(adapter, { name: "Retry Me", filename: "a.csv", content: "a\n1\n" }),
        ).rejects.toBe(storageError);
        expect(created).toEqual([]);
      });

      /** @scenario "Retrying a failed dataset create reuses the same name" */
      it("accepts the same name once storage is back, because nothing claimed it", async () => {
        const { adapter, created, restoreStorage, storageError } = harness({ storageFails: true });
        await expect(
          create(adapter, { name: "Retry Me", filename: "a.csv", content: "a\n1\n" }),
        ).rejects.toBe(storageError);

        restoreStorage();
        const result = await create(adapter, {
          name: "Retry Me",
          filename: "a.csv",
          content: "a\n1\n",
        });

        expect(result).toMatchObject({ name: "Retry Me", slug: "retry-me" });
        expect(created).toHaveLength(1);
      });
    });

    describe("when the file has an extension the family cannot read", () => {
      /** @scenario "Upload with unsupported file format is rejected" */
      it("refuses it as an unsupported format", async () => {
        const { adapter } = harness();

        await expect(
          create(adapter, { name: "Sheet", filename: "book.xlsx", content: "anything" }),
        ).rejects.toMatchObject({
          name: "UploadValidationError",
          kind: "unsupported_format",
          httpStatus: 422,
        });
      });

      /** @scenario "Upload with unsupported file format is rejected" */
      it("refuses an unsupported format for an existing dataset too", async () => {
        const { adapter } = harness({ row: datasetRow() });

        await expect(
          upload(adapter, {
            slugOrId: "user-feedback",
            filename: "book.xlsx",
            content: "anything",
          }),
        ).rejects.toMatchObject({ kind: "unsupported_format", httpStatus: 422 });
      });
    });

    describe("when the new dataset's file carries more rows than the organization's row count limit", () => {
      /** @scenario "Create + upload rejects file exceeding row limit" */
      it("refuses it on the parsed row count and creates nothing", async () => {
        const { adapter, created } = harness({ limits: { rowsMax: 1_000 } });
        const rows = Array.from({ length: 1_001 }, (_, i) => `${i},row ${i}`).join("\n");

        await expect(
          create(adapter, {
            name: "Too Big",
            filename: "big.csv",
            content: `input,output\n${rows}\n`,
          }),
        ).rejects.toMatchObject({ kind: "row_limit_exceeded", httpStatus: 400 });
        expect(created).toHaveLength(0);
      });
    });

    describe("when the new dataset's file holds pictures written inline as base64", () => {
      /** @scenario "An uploaded file with inline pictures stores each picture and keeps its reference" */
      it("stores each picture, keeps its reference and types the column as an image", async () => {
        const { adapter, created, chunkLines, storedFiles } = harness();

        await create(adapter, {
          name: "Scans",
          filename: "scans.jsonl",
          content: `${JSON.stringify({ label: "cat", scan: PNG_INLINE })}\n${JSON.stringify({ label: "dog", scan: PNG_INLINE })}\n`,
        });

        expect(storedFiles).toHaveLength(2);
        expect(chunkLines.map((line) => line.entry)).toEqual([
          { label: "cat", scan: `/api/files/${PROJECT_ID}/object-1/scan.png` },
          { label: "dog", scan: `/api/files/${PROJECT_ID}/object-2/scan.png` },
        ]);
        expect(created[0]?.columnTypes).toEqual([
          { name: "label", type: "string" },
          { name: "scan", type: "image" },
        ]);
      });
    });
  });

  describe("given a confirmed import file larger than the organization's upload limit", () => {
    const tooLarge = { limits: { fileBytes: 1024 * 1024 }, importBytes: 1024 * 1024 + 1 };
    const refusal = {
      kind: "file_too_large",
      message: expect.stringContaining("1 MB"),
    };

    describe("when a dataset is created from it", () => {
      /** @scenario "An import of a stored file larger than the upload limit is refused before it is read" */
      it("refuses before a dataset is made or the file is read", async () => {
        const { adapter, created, sourceReads } = harness(tooLarge);

        await expect(
          adapter.createDatasetFromStoredObject({
            projectId: PROJECT_ID,
            name: "Too Big",
            storedObjectId: "object-1",
          }),
        ).rejects.toMatchObject(refusal);
        expect(created).toHaveLength(0);
        expect(sourceReads).toEqual(["metadata"]);
      });
    });

    describe("when its rows are added to a dataset", () => {
      /** @scenario "An import of a stored file larger than the upload limit is refused before it is read" */
      it("refuses before the file is read", async () => {
        const { adapter, inlineRecords, sourceReads } = harness({
          ...tooLarge,
          row: datasetRow(),
        });

        await expect(
          adapter.appendStoredObjectToDataset({
            projectId: PROJECT_ID,
            slugOrId: "user-feedback",
            storedObjectId: "object-1",
          }),
        ).rejects.toMatchObject(refusal);
        expect(inlineRecords).toHaveLength(0);
        expect(sourceReads).toEqual(["metadata"]);
      });
    });
  });

  describe("given a dataset whose preparation was interrupted", () => {
    describe("when the preparation is retried", () => {
      /** @scenario "An interrupted preparation loses nothing and can be retried" */
      it("flips the dataset back to processing without losing the staged upload", async () => {
        const { adapter, updated } = harness({
          row: datasetRow({
            status: "failed",
            stagingKey: "staging/project-1/u1",
            uploadFilename: "big.csv",
          }),
        });

        const result = await adapter.retryNormalize({
          datasetId: "dataset_abc123",
          projectId: PROJECT_ID,
        });

        expect(result).toEqual({ datasetId: "dataset_abc123", status: "processing" });
        expect(updated).toEqual([
          expect.objectContaining({
            data: { status: "processing", statusError: null },
          }),
        ]);
      });
    });
  });
});
