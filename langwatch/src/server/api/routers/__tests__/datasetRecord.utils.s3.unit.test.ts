import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit-test the s3_jsonl read routing + status gating in `getFullDataset` at
 * its boundaries: a mocked `prisma.dataset.findFirst` returning an s3_jsonl
 * dataset row and a mocked `getDatasetStorage` whose `readChunks` returns fake
 * `{id, entry}` lines. The adapt/select/truncate logic under test stays real.
 */
const findFirst = vi.fn();
vi.mock("~/server/db", () => ({
  prisma: { dataset: { findFirst: (...a: unknown[]) => findFirst(...a) } },
}));

const getDatasetStorage = vi.fn();
vi.mock("../../../datasets/dataset-storage", () => ({
  getDatasetStorage: (...a: unknown[]) => getDatasetStorage(...a),
}));

import { getFullDataset, readDatasetHeadS3Jsonl } from "../datasetRecord.utils";

const baseDataset = {
  id: "dataset_1",
  projectId: "p1",
  name: "DS",
  slug: "ds",
  columnTypes: [{ name: "a", type: "string" }],
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
  archivedAt: null,
  useS3: false,
  s3RecordCount: null,
  contentLayout: "s3_jsonl",
  status: "ready",
  statusError: null,
  stagingKey: null,
  uploadFilename: null,
  rowCount: 2,
  sizeBytes: null,
  chunkCount: 1,
  chunkOffsets: null,
  mapping: null,
};

const mockReadChunks = (rows: unknown[]) => {
  const readChunks = vi.fn().mockResolvedValue(rows);
  getDatasetStorage.mockResolvedValue({ readChunks });
  return readChunks;
};

beforeEach(() => vi.clearAllMocks());

describe("getFullDataset()", () => {
  describe("when the dataset is s3_jsonl and ready", () => {
    it("reads chunks, adapts {id,entry} lines to DatasetRecord shape, and reports the PG row count", async () => {
      findFirst.mockResolvedValue({ ...baseDataset });
      const readChunks = mockReadChunks([
        { id: "r1", entry: { a: 1 } },
        { id: "r2", entry: { a: 2 } },
      ]);

      const result = await getFullDataset({
        datasetId: "dataset_1",
        projectId: "p1",
      });

      expect(readChunks).toHaveBeenCalledWith({
        projectId: "p1",
        datasetId: "dataset_1",
        chunkCount: 1,
      });
      expect(result?.count).toBe(2); // PG-authoritative rowCount, not read length
      expect(result?.datasetRecords).toEqual([
        {
          id: "r1",
          entry: { a: 1 },
          datasetId: "dataset_1",
          projectId: "p1",
          createdAt: baseDataset.createdAt,
          updatedAt: baseDataset.updatedAt,
        },
        {
          id: "r2",
          entry: { a: 2 },
          datasetId: "dataset_1",
          projectId: "p1",
          createdAt: baseDataset.createdAt,
          updatedAt: baseDataset.updatedAt,
        },
      ]);
    });
  });

  describe("when an entrySelection of 'first' is requested", () => {
    it("returns only the first adapted record", async () => {
      findFirst.mockResolvedValue({ ...baseDataset, rowCount: 3 });
      mockReadChunks([
        { id: "r1", entry: { a: 1 } },
        { id: "r2", entry: { a: 2 } },
        { id: "r3", entry: { a: 3 } },
      ]);

      const result = await getFullDataset({
        datasetId: "dataset_1",
        projectId: "p1",
        entrySelection: "first",
      });

      expect(result?.datasetRecords).toHaveLength(1);
      expect(result?.datasetRecords[0]?.id).toBe("r1");
      expect(result?.count).toBe(3);
    });
  });

  describe("when the dataset is s3_jsonl but not ready", () => {
    it("throws DatasetNotReadyError carrying the status without reading chunks", async () => {
      findFirst.mockResolvedValue({
        ...baseDataset,
        status: "processing",
        statusError: null,
      });
      const readChunks = mockReadChunks([]);

      await expect(
        getFullDataset({ datasetId: "dataset_1", projectId: "p1" }),
      ).rejects.toMatchObject({
        name: "DatasetNotReadyError",
        status: "processing",
      });
      expect(readChunks).not.toHaveBeenCalled();
    });
  });

  describe("when the dataset row does not exist", () => {
    it("returns null", async () => {
      findFirst.mockResolvedValue(null);

      const result = await getFullDataset({
        datasetId: "missing",
        projectId: "p1",
      });

      expect(result).toBeNull();
      expect(getDatasetStorage).not.toHaveBeenCalled();
    });
  });
});

describe("readDatasetHeadS3Jsonl()", () => {
  describe("when the dataset is ready", () => {
    it("reads only the first chunk, returns up to 5 adapted rows, and the PG row count", async () => {
      const readChunks = vi.fn().mockResolvedValue([
        { id: "r1", entry: { a: 1 } },
        { id: "r2", entry: { a: 2 } },
      ]);
      getDatasetStorage.mockResolvedValue({ readChunks });

      const result = await readDatasetHeadS3Jsonl({
        dataset: { ...baseDataset, rowCount: 42, chunkCount: 3 } as never,
        projectId: "p1",
      });

      // Head reads at most one chunk.
      expect(readChunks).toHaveBeenCalledWith({
        projectId: "p1",
        datasetId: "dataset_1",
        chunkCount: 1,
      });
      expect(result.total).toBe(42); // PG-authoritative rowCount
      expect(result.records.map((r) => r.id)).toEqual(["r1", "r2"]);
      expect(result.records[0]?.entry).toEqual({ a: 1 });
    });
  });

  describe("when the dataset is not ready", () => {
    it("throws DatasetNotReadyError without reading chunks", async () => {
      const readChunks = vi.fn();
      getDatasetStorage.mockResolvedValue({ readChunks });

      await expect(
        readDatasetHeadS3Jsonl({
          dataset: { ...baseDataset, status: "failed" } as never,
          projectId: "p1",
        }),
      ).rejects.toMatchObject({
        name: "DatasetNotReadyError",
        status: "failed",
      });
      expect(readChunks).not.toHaveBeenCalled();
    });
  });
});
