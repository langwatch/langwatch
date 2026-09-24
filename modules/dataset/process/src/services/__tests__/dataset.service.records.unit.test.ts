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
  createDatasetTestAttachments,
  createDatasetTestRequestBounds,
} from "../../app/__tests__/dataset.fixture.ts";
import type { DatasetUpdateInput } from "../../repositories/dataset.repository.ts";
import { MemoryDatasetRecordRepository } from "../../repositories/memory/memory.dataset-record.repository.ts";
import { MemoryDatasetDatabase } from "../../repositories/memory/memory.dataset.database.ts";
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

function service(overrides: { columnTypes?: DatasetColumns } = {}) {
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
  const repository = Object.assign(MemoryDatasetRepository.create({ database }), {
    findById: async ({ id }: { id: string; projectId: string }) => (id === row.id ? row : null),
    findBySlug: async ({ slug }: { slug: string; projectId: string }) =>
      slug === row.slug ? row : null,
    update,
  });

  const records = Object.assign(MemoryDatasetRecordRepository.create({ database }), {
    createMany,
    update: updateRecord,
  });

  return {
    service: DatasetService.create({
      repository,
      records,
      generateId: () => "generated-id",
      requestBounds: createDatasetTestRequestBounds(),
      attachments: createDatasetTestAttachments(),
    }),
    update,
    createMany,
    updateRecord,
  };
}

describe("DatasetService", () => {
  describe("given a dataset being renamed", () => {
    describe("when the new name slugifies differently", () => {
      /** @scenario "Update a dataset name regenerates the slug" */
      it("writes the slug the new name produces, not the one the row had", async () => {
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
            slug: "renamed-dataset",
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
