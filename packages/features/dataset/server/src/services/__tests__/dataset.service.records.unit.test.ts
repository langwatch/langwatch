/**
 * @vitest-environment node
 *
 * What the service decides on the way to the record table, which no door test
 * can see: the slug a rename produces, the columns a partial entry is filled
 * out to, and the U+0000 scrub that keeps a customer-supplied string out of
 * Postgres jsonb (error 22P05).
 *
 * Ported from the parts of `platform/app/src/app/api/dataset/__tests__/`
 * that proved service behaviour through Postgres. The repositories are fakes,
 * so the assertions are on what the service asked them to write.
 */
import { describe, expect, it, vi } from "vitest";
import type { DatasetRepository } from "../../repositories/dataset.repository";
import type { DatasetRecordRepository } from "../../repositories/dataset-record.repository";
import { DatasetService } from "../dataset.service";

const PROJECT_ID = "project-1";
const NULL_BYTE = String.fromCharCode(0);

const dataset = {
  id: "dataset-1",
  projectId: PROJECT_ID,
  name: "Feedback",
  slug: "feedback",
  columnTypes: [
    { name: "input", type: "string" },
    { name: "output", type: "string" },
  ],
  contentLayout: "inline",
  status: "ready",
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

function service(overrides: { columnTypes?: { name: string; type: string }[] } = {}) {
  const row = { ...dataset, columnTypes: overrides.columnTypes ?? dataset.columnTypes };
  const update = vi.fn(async (input: Record<string, unknown>) => ({ ...row, ...input }));
  const createMany = vi.fn(
    async ({ entries }: { entries: Record<string, unknown>[] }) =>
      entries.map((entry) => ({ id: String(entry.id), entry })),
  );
  const updateRecord = vi.fn(async (input: { id: string; entry: Record<string, unknown> }) => ({
    id: input.id,
    entry: input.entry,
  }));

  const repository = {
    tryFindById: async ({ id }: { id: string }) => (id === row.id ? row : null),
    tryFindBySlug: async ({ slug }: { slug: string }) => (slug === row.slug ? row : null),
    update,
  } as unknown as DatasetRepository;

  const records = {
    createMany,
    update: updateRecord,
  } as unknown as DatasetRecordRepository;

  return {
    service: DatasetService.create({ repository, records, generateId: () => "generated-id" }),
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
          expect.objectContaining({ id: "dataset-1", name: "Renamed Dataset", slug: "renamed-dataset" }),
        );
      });
    });
  });

  describe("given a dataset with two columns", () => {
    describe("when an entry names only one of them", () => {
      /** @scenario "Batch create records allows entries with subset of columns" */
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
