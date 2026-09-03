/**
 * The records an execution is handed, and how many of them.
 *
 * `getDatasetWithRecords` is what a run reads before it starts, so two things
 * have to hold. The selection has to give back exactly the entry that was
 * asked for — "first" is not "all", and an out-of-range index is a clamp
 * rather than a crash. And the result has to be BOUNDED: it is pulled fully
 * into memory 200 rows at a time and handed on, so a dataset nobody capped
 * would be read whole.
 *
 * When the cap bites, the caller is told. Truncating quietly would hand a run
 * a slice of a dataset and let it report a complete result.
 */

import { describe, expect, it } from "vitest";
import type { DatasetRepository } from "../../repositories/dataset.repository";
import type { DatasetRecordRepository } from "../../repositories/dataset-record.repository";
import { DatasetService } from "../dataset.service";

const PROJECT_ID = "project-1";

const dataset = {
  id: "dataset-1",
  projectId: PROJECT_ID,
  name: "Refunds",
  slug: "refunds",
  columnTypes: [],
  contentLayout: "inline",
  status: "ready",
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

/** `entry` is what the byte cap measures, so its size is the knob under test. */
const record = (id: string, entrySize = 10) => ({
  id,
  datasetId: dataset.id,
  projectId: PROJECT_ID,
  entry: { text: "x".repeat(Math.max(0, entrySize - 12)) },
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

function serviceHolding(records: ReturnType<typeof record>[]) {
  const repository = {
    tryFindById: async () => null,
    tryFindBySlug: async () => dataset,
  } as unknown as DatasetRepository;

  const recordsRepository = {
    list: async ({ page, limit }: { page: number; limit: number }) => ({
      records: records.slice((page - 1) * limit, page * limit),
      total: records.length,
    }),
  } as unknown as DatasetRecordRepository;

  return DatasetService.create({ repository, records: recordsRepository });
}

const read = (
  records: ReturnType<typeof record>[],
  over: { limitMb?: number | null; entrySelection?: unknown } = {},
) =>
  serviceHolding(records).getDatasetWithRecords({
    projectId: PROJECT_ID,
    slugOrId: "refunds",
    ...(over as Record<string, never>),
  });

describe("DatasetService.getDatasetWithRecords", () => {
  describe("given a dataset that fits well inside the cap", () => {
    it("hands back every record, untruncated", async () => {
      const result = await read([record("a"), record("b"), record("c")]);

      expect(result.records.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
      expect(result.truncated).toBe(false);
    });

    it("reads past the first page, so a large dataset is not silently cut at 200", async () => {
      const many = Array.from({ length: 250 }, (_, index) => record(`r${index}`));

      const result = await read(many, { limitMb: null });

      expect(result.records).toHaveLength(250);
    });
  });

  describe("given the byte cap bites", () => {
    it("stops at the cap and says the result was truncated", async () => {
      // Roughly a megabyte of entry each, against a 2 MB cap.
      const big = Array.from({ length: 5 }, (_, index) => record(`r${index}`, 1024 * 1024));

      const result = await read(big, { limitMb: 2 });

      expect(result.records.length).toBeLessThan(5);
      expect(result.truncated).toBe(true);
    });

    it("does not truncate when the cap is lifted", async () => {
      const big = Array.from({ length: 5 }, (_, index) => record(`r${index}`, 1024 * 1024));

      const result = await read(big, { limitMb: null });

      expect(result.records).toHaveLength(5);
      expect(result.truncated).toBe(false);
    });
  });

  describe("given a selection", () => {
    const three = [record("a"), record("b"), record("c")];

    it("takes the first", async () => {
      expect((await read(three, { entrySelection: "first" })).records.map((r) => r.id)).toEqual([
        "a",
      ]);
    });

    it("takes the last", async () => {
      expect((await read(three, { entrySelection: "last" })).records.map((r) => r.id)).toEqual([
        "c",
      ]);
    });

    it("takes the one at an index", async () => {
      expect((await read(three, { entrySelection: 1 })).records.map((r) => r.id)).toEqual(["b"]);
    });

    it("clamps an index past the end rather than answering with nothing", async () => {
      // An out-of-range index is a caller's mistake, and handing a run zero
      // records would make it report success over an empty dataset.
      expect((await read(three, { entrySelection: 99 })).records.map((r) => r.id)).toEqual(["c"]);
    });

    it("refuses a negative index at the boundary, before any clamp", async () => {
      // The schema is `z.number().int().nonnegative()`, so the `Math.max(_, 0)`
      // in the selection is unreachable through this entry point. The refusal
      // is the behaviour; the clamp is belt and braces behind it.
      await expect(read(three, { entrySelection: -5 })).rejects.toThrow();
    });

    it("takes exactly one when asked for a random entry", async () => {
      const result = await read(three, { entrySelection: "random" });

      expect(result.records).toHaveLength(1);
      expect(["a", "b", "c"]).toContain(result.records[0]?.id);
    });

    it("answers with nothing when there is nothing to select from", async () => {
      expect((await read([], { entrySelection: "first" })).records).toEqual([]);
    });
  });
});
