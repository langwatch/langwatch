/**
 * @vitest-environment node
 *
 * What an uploaded file BECOMES: which rows are parsed out of CSV, JSONL and a
 * JSON array, how their string cells are coerced to the dataset's declared
 * column types, and — for the create-and-upload door — what columns the file's
 * header turns into.
 *
 * Ported from `platform/app/src/app/api/dataset/__tests__/dataset-upload-api.integration.test.ts`,
 * which drove the same adapter through Postgres. The repositories and the
 * object storage are fakes here, so what is asserted is the adapter's own
 * decisions rather than Prisma's.
 */
import { describe, expect, it } from "vitest";
import { MAX_FILE_SIZE_BYTES } from "@langwatch/dataset-contract";
import type { DatasetStorage, DatasetStorageResolver } from "../../ports/dataset-storage.port";
import type { DatasetRow } from "../../ports/dataset.port";
import type { DatasetContentRepository } from "../../repositories/prisma/dataset-content.repository";
import type { DatasetRecordContentRepository } from "../../repositories/prisma/dataset-record-content.repository";
import { DatasetUploadAdapter } from "../dataset-upload.adapter";

const PROJECT_ID = "project-1";
const NULL_BYTE = String.fromCharCode(0);

type WrittenRecord = { id: string; entry: Record<string, unknown> };

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
}: { row?: DatasetRow | null; storageFails?: boolean } = {}) {
  const created: Record<string, unknown>[] = [];
  const inlineRecords: WrittenRecord[] = [];
  const chunkLines: WrittenRecord[] = [];
  let failing = storageFails;

  const updated: Record<string, unknown>[] = [];
  const datasets = {
    tryFindOne: async ({ id }: { id: string }) => (row && row.id === id ? row : null),
    tryFindBySlug: async ({ slug }: { slug: string }) => (row && row.slug === slug ? row : null),
    create: async (input: Record<string, unknown>) => {
      created.push(input);
      return datasetRow({ ...(input as Partial<DatasetRow>) });
    },
    update: async (input: Record<string, unknown>) => {
      updated.push(input);
      return datasetRow();
    },
  } as unknown as DatasetContentRepository;

  const records = {
    createMany: async ({ records: written }: { records: WrittenRecord[] }) => {
      inlineRecords.push(...written);
      return written;
    },
  } as unknown as DatasetRecordContentRepository;

  const storage = {
    writeChunks: async ({ records: lines }: { records: WrittenRecord[] }) => {
      if (failing) throw new Error("object storage is unavailable");
      chunkLines.push(...lines);
      return [{ index: 0, rowCount: lines.length, byteSize: lines.length * 10 }];
    },
    deleteChunksFrom: async () => undefined,
  } as unknown as DatasetStorage;

  const storageResolver = {
    forProject: async () => storage,
  } as unknown as DatasetStorageResolver;

  return {
    adapter: DatasetUploadAdapter.create({ datasets, records, storageResolver }),
    created,
    updated,
    inlineRecords,
    chunkLines,
    restoreStorage: () => {
      failing = false;
    },
  };
}

const upload = (
  adapter: DatasetUploadAdapter,
  { slugOrId, filename, content }: { slugOrId: string; filename: string; content: string },
) =>
  adapter.uploadToExistingDataset({
    slugOrId,
    projectId: PROJECT_ID,
    filename,
    content,
    fileSize: Buffer.byteLength(content, "utf8"),
  });

const create = (
  adapter: DatasetUploadAdapter,
  input: { name: string; filename: string; content: string },
) =>
  adapter.createDatasetFromUpload({
    projectId: PROJECT_ID,
    name: input.name,
    filename: input.filename,
    content: input.content,
    fileSize: Buffer.byteLength(input.content, "utf8"),
  });

describe("DatasetUploadAdapter", () => {
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
        ).rejects.toMatchObject({ name: "UploadValidationError", kind: "column_mismatch" });
        expect(inlineRecords).toHaveLength(0);
      });
    });

    describe("when the file carries no data rows", () => {
      it("refuses it as empty before any dataset is read", async () => {
        const { adapter } = harness({ row: datasetRow() });

        await expect(
          upload(adapter, {
            slugOrId: "user-feedback",
            filename: "feedback.csv",
            content: "input,output\n",
          }),
        ).rejects.toMatchObject({ name: "UploadValidationError", kind: "empty_file" });
      });
    });

    describe("when the file is larger than the family accepts", () => {
      it("refuses it on size alone, without parsing it", async () => {
        const { adapter } = harness({ row: datasetRow() });

        await expect(
          adapter.uploadToExistingDataset({
            slugOrId: "user-feedback",
            projectId: PROJECT_ID,
            filename: "feedback.csv",
            content: "input,output\nhello,world\n",
            fileSize: MAX_FILE_SIZE_BYTES + 1,
          }),
        ).rejects.toMatchObject({ name: "UploadValidationError", kind: "file_too_large" });
      });
    });

    describe("when the dataset the path names does not exist", () => {
      it("refuses rather than creating one on the way past", async () => {
        const { adapter } = harness({ row: null });

        await expect(
          upload(adapter, {
            slugOrId: "does-not-exist",
            filename: "feedback.csv",
            content: "input\nhello\n",
          }),
        ).rejects.toMatchObject({ name: "DatasetNotFoundError" });
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
        const { adapter, created } = harness({ storageFails: true });

        await expect(
          create(adapter, { name: "Retry Me", filename: "a.csv", content: "a\n1\n" }),
        ).rejects.toThrow();
        expect(created).toEqual([]);
      });

      /** @scenario "Retrying a failed dataset create reuses the same name" */
      it("accepts the same name once storage is back, because nothing claimed it", async () => {
        const { adapter, created, restoreStorage } = harness({ storageFails: true });
        await expect(
          create(adapter, { name: "Retry Me", filename: "a.csv", content: "a\n1\n" }),
        ).rejects.toThrow();

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
      it("refuses it as an unsupported format", async () => {
        const { adapter } = harness();

        await expect(
          create(adapter, { name: "Sheet", filename: "book.xlsx", content: "anything" }),
        ).rejects.toThrow(/Unsupported file format/);
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
