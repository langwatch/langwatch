/** Dataset reads must be exact (first ≠ all, out-of-range clamps) and
 * bounded (200 rows at a time). Caller told when capped.
 */

import type { Dataset, DatasetRecord } from "@langwatch/dataset-contract";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import {
  createDatasetTestAttachments,
  createDatasetTestRequestBounds,
} from "../../app/__tests__/dataset.fixture.ts";
import { MemoryDatasetRecordRepository } from "../../repositories/memory/memory.dataset-record.repository.ts";
import { MemoryDatasetDatabase } from "../../repositories/memory/memory.dataset.database.ts";
import { MemoryDatasetRepository } from "../../repositories/memory/memory.dataset.repository.ts";
import { DatasetService } from "../dataset.service.ts";

const PROJECT_ID = "project-1";

const dataset: Dataset = {
  id: "dataset-1",
  projectId: PROJECT_ID,
  name: "Refunds",
  slug: "refunds",
  columnTypes: [],
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

/** `entry` is what the byte cap measures, so its size is the knob under test. */
const record = (id: string, entrySize = 10): DatasetRecord => ({
  id,
  datasetId: dataset.id,
  projectId: PROJECT_ID,
  entry: { text: "x".repeat(Math.max(0, entrySize - 12)) },
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

function serviceHolding(records: DatasetRecord[]) {
  const database = MemoryDatasetDatabase.create();
  const repository = Object.assign(MemoryDatasetRepository.create({ database }), {
    findById: async (): Promise<Dataset | null> => null,
    findBySlug: async (): Promise<Dataset | null> => dataset,
  });

  const recordsRepository = Object.assign(MemoryDatasetRecordRepository.create({ database }), {
    listAll: async ({ page, limit }: { page: number; limit: number }) => ({
      records: records.slice((page - 1) * limit, page * limit),
      total: records.length,
    }),
  });

  return DatasetService.create({
    repository,
    records: recordsRepository,
    requestBounds: createDatasetTestRequestBounds(),
    attachments: createDatasetTestAttachments(),
  });
}

const read = (
  records: DatasetRecord[],
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
      await expect(read(three, { entrySelection: -5 })).rejects.toThrow(ZodError);
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
