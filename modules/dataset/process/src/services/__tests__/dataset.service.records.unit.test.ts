import {
  InvalidColumnError,
  type Dataset,
  type DatasetColumns,
  type DatasetRecord,
  type DatasetRecordInput,
} from "@langwatch/dataset-contract";
/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from "vitest";

import {
  createDatasetTestApp,
  createDatasetTestAttachments,
  createDatasetTestContent,
  createDatasetTestInlineAttachments,
  createDatasetTestRequestBounds,
} from "../../app/__tests__/dataset.fixture.ts";
import type { DatasetUpdateInput } from "../../repositories/dataset.repository.ts";
import { MemoryDatasetRecordRepository } from "../../repositories/memory/memory.dataset-record.repository.ts";
import { MemoryDatasetDatabase } from "../../repositories/memory/memory.dataset.database.ts";
import { MemoryDatasetRepositories } from "../../repositories/memory/memory.dataset.repositories.ts";
import { MemoryDatasetRepository } from "../../repositories/memory/memory.dataset.repository.ts";
import { DatasetService } from "../dataset.service.ts";

const PROJECT_ID = "project-1";
const NULL_BYTE = String.fromCharCode(0);

const dataset: Dataset = {
  id: "dataset-1",
  projectId: PROJECT_ID,
  name: "Feedback",
  slug: "feedback",
  columnTypes: [
    { name: "input", type: "string" },
    { name: "output", type: "string" },
  ],
  contentLayout: "postgres",
  status: "ready",
  createdAt: new Date(0),
  updatedAt: new Date(0),
  archivedAt: null,
  mapping: null,
  useS3: false,
  s3RecordCount: null,
  statusError: null,
  stagingKey: null,
  uploadFilename: null,
  rowCount: null,
  sizeBytes: null,
  chunkCount: null,
  chunkOffsets: null,
};

const storedRecord = (
  input: Pick<DatasetRecord, "id" | "datasetId" | "projectId" | "entry">,
): DatasetRecord => ({ ...input, createdAt: new Date(0), updatedAt: new Date(0) });

function service(overrides: { columnTypes?: DatasetColumns; realRecords?: boolean } = {}) {
  const row: Dataset = { ...dataset, columnTypes: overrides.columnTypes ?? dataset.columnTypes };
  const update = vi.fn(async (input: DatasetUpdateInput): Promise<Dataset> => ({
    ...row,
    ...input,
  }));
  const createMany = vi.fn(
    async (input: {
      datasetId: string;
      projectId: string;
      entries: (DatasetRecordInput & { id: string })[];
    }): Promise<DatasetRecord[]> =>
      input.entries.map((entry) =>
        storedRecord({
          id: entry.id,
          datasetId: input.datasetId,
          projectId: input.projectId,
          entry,
        }),
      ),
  );
  const updateRecord = vi.fn(
    async (input: {
      id: string;
      datasetId: string;
      projectId: string;
      entry: Record<string, unknown>;
    }): Promise<DatasetRecord> => storedRecord(input),
  );

  const database = MemoryDatasetDatabase.create();
  database.putDataset({ ...row, sourceStoredObjectId: null });
  const repository = Object.assign(MemoryDatasetRepository.create({ database }), {
    findById: async ({ id }: { id: string; projectId: string }) => (id === row.id ? row : null),
    findBySlug: async ({ slug }: { slug: string; projectId: string }) =>
      slug === row.slug ? row : null,
    update,
  });

  const memoryRecords = MemoryDatasetRecordRepository.create({ database });
  const records = overrides.realRecords
    ? memoryRecords
    : Object.assign(memoryRecords, { createMany, update: updateRecord });

  return {
    service: DatasetService.create({
      repository,
      records,
      content: createDatasetTestContent({ database }),
      generateId: () => "generated-id",
      requestBounds: createDatasetTestRequestBounds(),
      attachments: createDatasetTestAttachments(),
      inlineAttachments: createDatasetTestInlineAttachments(),
    }),
    update,
    createMany,
    updateRecord,
    records,
    database,
  };
}

describe("DatasetService", () => {
  describe("given a dataset being renamed", () => {
    describe("when the new name slugifies differently", () => {
      /** @scenario "Saving a rename from the UI keeps the slug" */
      it("writes the slug the row already had, not one the new name produces", async () => {
        const { service: subject, update } = service();

        await subject.upsertDataset({
          projectId: PROJECT_ID,
          datasetId: "dataset-1",
          name: "Renamed Dataset",
          columnTypes: [{ name: "input", type: "string" }],
        });

        expect(update).toHaveBeenCalledWith(
          expect.objectContaining({
            id: "dataset-1",
            name: "Renamed Dataset",
            slug: "feedback",
          }),
        );
      });
    });
  });

  describe("given a dataset with two columns", () => {
    describe("when an entry names only one of them", () => {
      /**
       * @scenario "Batch create records allows entries with subset of columns"
       * @scenario "An entry naming only some of the dataset's columns is accepted"
       */
      it("fills the column the entry left out with null", async () => {
        const { service: subject, createMany } = service();

        await subject.batchCreateRecords({
          slugOrId: "feedback",
          projectId: PROJECT_ID,
          entries: [{ input: "hi" }],
        });

        expect(createMany).toHaveBeenCalledWith(
          expect.objectContaining({
            entries: [{ id: "generated-id", input: "hi", output: null }],
          }),
        );
      });
    });

    describe("when a caller writes deterministic ids and may retry a page", () => {
      it("asks the store to skip duplicate ids instead of failing the batch", async () => {
        const { service: subject, createMany } = service();

        await subject.batchCreateRecords({
          slugOrId: "feedback",
          projectId: PROJECT_ID,
          entries: [{ id: "trigger-1-trace-1-0", input: "hi" }],
          skipDuplicates: true,
        });

        expect(createMany).toHaveBeenCalledWith(
          expect.objectContaining({
            entries: [{ id: "trigger-1-trace-1-0", input: "hi", output: null }],
            skipDuplicates: true,
          }),
        );
      });

      /** @scenario "A dataset row that already exists counts as added" */
      it("leaves one row when the same id is written twice with skipDuplicates", async () => {
        const { service: subject, records } = service({ realRecords: true });
        const input = {
          slugOrId: "feedback",
          projectId: PROJECT_ID,
          entries: [{ id: "trigger-1-trace-1-0", input: "hi" }],
          skipDuplicates: true,
        };

        await subject.batchCreateRecords(input);
        await subject.batchCreateRecords(input);

        const page = await records.listAll({
          datasetId: "dataset-1",
          projectId: PROJECT_ID,
          page: 1,
          limit: 10,
        });
        expect(page.total).toBe(1);
        expect(page.records.map((record) => record.id)).toEqual(["trigger-1-trace-1-0"]);
      });

      it("returns the row an earlier attempt stored when the caller reads existing rows back", async () => {
        const { service: subject } = service({ realRecords: true });
        const first = {
          slugOrId: "feedback",
          projectId: PROJECT_ID,
          entries: [{ id: "trigger-1-trace-1-0", input: "first" }],
          skipDuplicates: true,
          readBackExisting: true,
        };

        await subject.batchCreateRecords(first);
        const retried = await subject.batchCreateRecords({
          ...first,
          entries: [{ id: "trigger-1-trace-1-0", input: "different mapping" }],
        });

        expect(retried.map((record) => record.entry)).toEqual([{ input: "first", output: null }]);
      });

      describe("when retries verify existing rows", () => {
        const retry = {
          slugOrId: "feedback",
          projectId: PROJECT_ID,
          skipDuplicates: true,
          verifyExisting: true,
        };

        /** @scenario "A record write that arrives during a column edit waits for it and is refused when keyed by a removed column" */
        it("rejects a retry whose cached columns were removed under the dataset lock", async () => {
          const { service: subject, records } = service({ realRecords: true });
          await records.withDatasetLock(
            { datasetId: dataset.id, projectId: PROJECT_ID },
            (locked) => locked.setColumnTypes([{ name: "input", type: "string" }]),
          );

          await expect(
            subject.batchCreateRecords({
              ...retry,
              readBackExisting: true,
              entries: [{ id: "row-0", input: "same", output: "stale" }],
            }),
          ).rejects.toMatchObject({ code: "dataset_stale_columns" });

          expect(await records.count({ datasetId: dataset.id, projectId: PROJECT_ID })).toBe(0);
        });

        it("does not append shifted expansion rows when an existing row conflicts", async () => {
          const { service: subject, records } = service({ realRecords: true });
          await subject.batchCreateRecords({ ...retry, entries: [{ id: "row-0", input: "old" }] });
          await expect(
            subject.batchCreateRecords({
              ...retry,
              entries: [
                { id: "row-1", input: "old" },
                { id: "row-0", input: "inserted" },
              ],
            }),
          ).rejects.toMatchObject({ code: "dataset_record_conflict" });
          const page = await records.listAll({
            datasetId: "dataset-1",
            projectId: PROJECT_ID,
            page: 1,
            limit: 10,
          });
          expect(page.records.map(({ id, entry }) => ({ id, entry }))).toEqual([
            { id: "row-0", entry: { input: "old", output: null } },
          ]);
        });

        it("rejects a removed mapping column rather than retaining its old value", async () => {
          const { service: subject } = service({ realRecords: true });
          await subject.batchCreateRecords({
            ...retry,
            entries: [{ id: "row-0", input: "same", output: "old" }],
          });
          await expect(
            subject.batchCreateRecords({ ...retry, entries: [{ id: "row-0", input: "same" }] }),
          ).rejects.toMatchObject({ code: "dataset_record_conflict" });
        });

        it("accepts identical retries after normalization fills missing columns", async () => {
          const { service: subject } = service({ realRecords: true });
          await subject.batchCreateRecords({ ...retry, entries: [{ id: "row-0", input: "same" }] });
          const rows = await subject.batchCreateRecords({
            ...retry,
            entries: [{ id: "row-0", input: "same", output: null }],
          });
          expect(rows.map(({ entry }) => entry)).toEqual([{ input: "same", output: null }]);
        });
      });

      it("still rejects a duplicate id when skipDuplicates is false", async () => {
        const { service: subject, records } = service({ realRecords: true });
        const input = {
          slugOrId: "feedback",
          projectId: PROJECT_ID,
          entries: [{ id: "trigger-1-trace-1-0", input: "hi" }],
        };

        await subject.batchCreateRecords(input);
        await expect(
          subject.batchCreateRecords({ ...input, skipDuplicates: false }),
        ).rejects.toThrow(/Unique constraint failed on the fields: \(id\)/);

        const page = await records.listAll({
          datasetId: "dataset-1",
          projectId: PROJECT_ID,
          page: 1,
          limit: 10,
        });
        expect(page.total).toBe(1);
      });
    });

    describe("when an entry carries a null byte", () => {
      /** @scenario "Batch create records via REST sanitises null bytes" */
      it("scrubs it before the record reaches the table", async () => {
        const { service: subject, createMany } = service({
          columnTypes: [{ name: "input", type: "string" }],
        });

        await subject.batchCreateRecords({
          slugOrId: "feedback",
          projectId: PROJECT_ID,
          entries: [{ input: `hello${NULL_BYTE}world` }],
        });

        expect(createMany).toHaveBeenCalledWith(
          expect.objectContaining({ entries: [{ id: "generated-id", input: "helloworld" }] }),
        );
      });
    });
  });

  describe("given a dataset whose columns are input and output", () => {
    describe("when an entry also names a column the dataset does not define", () => {
      /** @scenario "An entry naming a column the dataset does not define is refused" */
      it("refuses the creation as an invalid column", async () => {
        const { service: subject } = service();

        await expect(
          subject.batchCreateRecords({
            slugOrId: "feedback",
            projectId: PROJECT_ID,
            entries: [{ input: "hi", notes: "dropped on the floor" }],
          }),
        ).rejects.toSatisfy((error: Error) => error.name === "InvalidColumnError");
      });

      /** @scenario "An entry naming a column the dataset does not define is refused" */
      it("names the offending column and the columns that are valid", async () => {
        const { service: subject } = service();

        let error: unknown;
        try {
          await subject.batchCreateRecords({
            slugOrId: "feedback",
            projectId: PROJECT_ID,
            entries: [{ input: "hi", notes: "dropped on the floor" }],
          });
        } catch (thrown) {
          error = thrown;
        }

        expect(error).toBeInstanceOf(InvalidColumnError);
        expect((error as InvalidColumnError).columnName).toBe("notes");
        expect((error as InvalidColumnError).validColumns).toEqual(["input", "output"]);
      });

      /** @scenario "An entry naming a column the dataset does not define is refused" */
      it("writes nothing to the record store", async () => {
        const { service: subject, createMany } = service();

        await subject
          .batchCreateRecords({
            slugOrId: "feedback",
            projectId: PROJECT_ID,
            entries: [{ input: "hi" }, { input: "bye", notes: "dropped on the floor" }],
          })
          .catch(() => undefined);

        expect(createMany).not.toHaveBeenCalled();
      });
    });

    describe("when an entry carries its own record id", () => {
      /** @scenario "A record identifier is not treated as a column" */
      it("writes the record under the identifier the caller supplied", async () => {
        const { service: subject, createMany } = service();

        await subject.batchCreateRecords({
          slugOrId: "feedback",
          projectId: PROJECT_ID,
          entries: [{ id: "rec-supplied", input: "hi" }],
        });

        expect(createMany).toHaveBeenCalledWith(
          expect.objectContaining({
            entries: [{ id: "rec-supplied", input: "hi", output: null }],
          }),
        );
      });
    });
  });

  describe("given one record being replaced by id", () => {
    describe("when the new entry carries a null byte", () => {
      /** @scenario "Update record via REST sanitises null bytes" */
      it("scrubs it before the record reaches the table", async () => {
        const { service: subject, updateRecord } = service({
          columnTypes: [{ name: "input", type: "string" }],
        });

        const result = await subject.upsertRecord({
          slugOrId: "feedback",
          projectId: PROJECT_ID,
          recordId: "rec-1",
          updatedRecord: { input: `new${NULL_BYTE}value` },
        });

        expect(updateRecord).toHaveBeenCalledWith(
          expect.objectContaining({ id: "rec-1", entry: { input: "newvalue" } }),
        );
        expect(result.record.entry).toEqual({ input: "newvalue" });
      });
    });
  });
});

describe.each(["s3_jsonl", "single-file"] as const)("verified retries in %s", (layout) => {
  async function setup() {
    const repositories = MemoryDatasetRepositories.create();
    const dataset = await repositories.content.create({
      projectId: PROJECT_ID,
      name: "Retries",
      slug: "retries",
      columnTypes: [{ name: "input", type: "string" }],
      contentLayout: layout === "s3_jsonl" ? "s3_jsonl" : "postgres",
      useS3: layout === "single-file",
      s3RecordCount: 0,
      rowCount: 0,
      chunkCount: 0,
      chunkOffsets: [],
      sizeBytes: 0n,
    });
    const app = createDatasetTestApp({ repositories });
    const lookup = { slugOrId: dataset.id, projectId: PROJECT_ID };
    const input = {
      ...lookup,
      entries: [{ id: "trace-0", input: "same" }],
      skipDuplicates: true,
      readBackExisting: true,
      verifyExisting: true,
    };
    await app.batchCreateRecords(input);

    return { app, repositories, input, lookup };
  }

  /** @scenario "A verified retry is atomic and compares complete normalized entries" */
  it("returns the stored row without appending it again", async () => {
    const { app, repositories, input, lookup } = await setup();
    const before = await app.listRecords(lookup);

    const retried = await app.batchCreateRecords(input);
    const after = await app.listRecords(lookup);
    const dataset = await repositories.content.getOne({
      id: input.slugOrId,
      projectId: PROJECT_ID,
    });

    expect(after.data).toHaveLength(1);
    expect(retried).toEqual(before.data);
    expect(layout === "s3_jsonl" ? dataset.rowCount : dataset.s3RecordCount).toBe(1);
  });

  /** @scenario "A verified retry is atomic and compares complete normalized entries" */
  it("rejects conflicting content before writing any new expansion rows", async () => {
    const { app, repositories, input, lookup } = await setup();
    const before = await app.listRecords(lookup);
    const dataset = await repositories.content.getOne({
      id: input.slugOrId,
      projectId: PROJECT_ID,
    });
    const chunks = vi.spyOn(repositories.chunks, "writeChunks");
    const singleFile = vi.spyOn(repositories.singleFiles, "putSingleFile");

    await expect(
      app.batchCreateRecords({
        ...input,
        entries: [
          { id: "trace-1", input: "new expansion" },
          { id: "trace-0", input: "changed" },
        ],
      }),
    ).rejects.toMatchObject({ code: "dataset_record_conflict" });

    expect(chunks).not.toHaveBeenCalled();
    expect(singleFile).not.toHaveBeenCalled();
    expect(await app.listRecords(lookup)).toEqual(before);
    expect(
      await repositories.content.getOne({ id: input.slugOrId, projectId: PROJECT_ID }),
    ).toEqual(dataset);
  });
});

describe.each(["postgres", "s3_jsonl", "single-file"] as const)(
  "same-batch duplicates in %s",
  (layout) => {
    /** @scenario "Identical IDs in one batch are stored once in every layout" */
    it.each([false, true])("stores one row with verifyExisting=%s", async (verifyExisting) => {
      const repositories = MemoryDatasetRepositories.create();
      const dataset = await repositories.content.create({
        projectId: PROJECT_ID,
        name: "Batch duplicates",
        slug: "batch-duplicates",
        columnTypes: [{ name: "input", type: "string" }],
        contentLayout: layout === "s3_jsonl" ? "s3_jsonl" : "postgres",
        useS3: layout === "single-file",
        s3RecordCount: 0,
        rowCount: 0,
        chunkCount: 0,
        chunkOffsets: [],
        sizeBytes: 0n,
      });
      const app = createDatasetTestApp({ repositories });
      const lookup = { slugOrId: dataset.id, projectId: PROJECT_ID };

      await app.batchCreateRecords({
        ...lookup,
        entries: [
          { id: "r1", input: "same" },
          { id: "r1", input: "same" },
        ],
        skipDuplicates: true,
        readBackExisting: true,
        verifyExisting,
      });

      await expect(
        app.batchCreateRecords({
          ...lookup,
          entries: [
            { id: "r2", input: "first" },
            { id: "r2", input: "changed" },
          ],
          skipDuplicates: true,
          verifyExisting: true,
        }),
      ).rejects.toMatchObject({ code: "dataset_record_conflict" });

      const page = await app.listRecords(lookup);
      expect(page.data).toEqual([expect.objectContaining({ id: "r1", entry: { input: "same" } })]);
      expect(page.pagination.total).toBe(1);
      const stored = await repositories.content.getOne({ id: dataset.id, projectId: PROJECT_ID });
      const counts = {
        postgres: page.pagination.total,
        s3_jsonl: stored.rowCount,
        "single-file": stored.s3RecordCount,
      };
      expect(counts[layout]).toBe(1);
    });
  },
);

describe("MemoryDatasetRecordRepository.createMany", () => {
  const repository = () =>
    MemoryDatasetRecordRepository.create({ database: MemoryDatasetDatabase.create() });
  const list = (records: MemoryDatasetRecordRepository, datasetId: string) =>
    records.listAll({ datasetId, projectId: PROJECT_ID, page: 1, limit: 10 });

  describe("when an id already belongs to another dataset in the same project", () => {
    it("skips it instead of replacing the row in the other dataset", async () => {
      const records = repository();

      await records.createMany({
        datasetId: "dataset-a",
        projectId: PROJECT_ID,
        entries: [{ id: "shared-id", input: "first" }],
      });
      await records.createMany({
        datasetId: "dataset-b",
        projectId: PROJECT_ID,
        entries: [{ id: "shared-id", input: "second" }],
        skipDuplicates: true,
      });

      const first = await list(records, "dataset-a");
      expect(first.total).toBe(1);
      expect(first.records[0]?.entry).toEqual({ input: "first" });
      expect((await list(records, "dataset-b")).records).toEqual([]);
    });

    it("rejects the write when skipDuplicates is false", async () => {
      const records = repository();

      await records.createMany({
        datasetId: "dataset-a",
        projectId: PROJECT_ID,
        entries: [{ id: "shared-id", input: "first" }],
      });

      await expect(
        records.createMany({
          datasetId: "dataset-b",
          projectId: PROJECT_ID,
          entries: [{ id: "shared-id", input: "second" }],
          skipDuplicates: false,
        }),
      ).rejects.toThrow(/Unique constraint failed on the fields: \(id\)/);
      expect((await list(records, "dataset-a")).records[0]?.entry).toEqual({ input: "first" });
      expect((await list(records, "dataset-b")).records).toEqual([]);
    });
  });

  describe("when the same id appears twice in one batch", () => {
    it("keeps the first row, as Prisma does", async () => {
      const records = repository();

      await records.createMany({
        datasetId: "dataset-a",
        projectId: PROJECT_ID,
        entries: [
          { id: "twice", input: "first" },
          { id: "twice", input: "second" },
        ],
        skipDuplicates: true,
      });

      const page = await list(records, "dataset-a");
      expect(page.total).toBe(1);
      expect(page.records[0]?.entry).toEqual({ input: "first" });
    });
  });
});
