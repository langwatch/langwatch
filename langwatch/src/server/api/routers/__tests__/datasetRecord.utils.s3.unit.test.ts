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
  const readChunk = vi.fn();
  getDatasetStorage.mockResolvedValue({ readChunks, readChunk });
  return readChunks;
};

/**
 * Mock storage for the M2 single-chunk short-circuit: `readChunk(index)`
 * resolves the rows of `chunksByIndex[index]`; `readChunks` is a spy that must
 * NOT be called when the short-circuit fires.
 */
const mockReadChunk = (chunksByIndex: Record<number, unknown[]>) => {
  const readChunks = vi.fn();
  const readChunk = vi.fn(({ index }: { index: number }) =>
    Promise.resolve(chunksByIndex[index] ?? []),
  );
  getDatasetStorage.mockResolvedValue({ readChunks, readChunk });
  return { readChunks, readChunk };
};

beforeEach(() => vi.clearAllMocks());

describe("getFullDataset()", () => {
  describe("when the dataset is s3_jsonl and ready", () => {
    it("reads chunks incrementally, adapts {id,entry} lines to DatasetRecord shape, and reports the PG row count", async () => {
      // baseDataset has chunkCount 1; "all" reads it one chunk at a time.
      findFirst.mockResolvedValue({ ...baseDataset });
      const { readChunks, readChunk } = mockReadChunk({
        0: [
          { id: "r1", entry: { a: 1 } },
          { id: "r2", entry: { a: 2 } },
        ],
      });

      const result = await getFullDataset({
        datasetId: "dataset_1",
        projectId: "p1",
      });

      expect(readChunk).toHaveBeenCalledWith({
        projectId: "p1",
        datasetId: "dataset_1",
        index: 0,
      });
      expect(readChunks).not.toHaveBeenCalled();
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

  // M2: a single-row `entrySelection` reads ONLY the chunk that holds the row
  // (via chunkOffsets), never the whole dataset. Two chunks of 2 rows each;
  // assert `readChunk` is called with the right index and `readChunks` isn't.
  const twoChunkDataset = {
    ...baseDataset,
    rowCount: 4,
    chunkCount: 2,
    chunkOffsets: [
      { index: 0, startRow: 0, endRow: 2, byteSize: 100 },
      { index: 1, startRow: 2, endRow: 4, byteSize: 100 },
    ] as unknown,
  };

  describe("when an entrySelection of 'first' is requested", () => {
    it("reads only chunk 0 and returns its first row", async () => {
      findFirst.mockResolvedValue({ ...twoChunkDataset });
      const { readChunks, readChunk } = mockReadChunk({
        0: [
          { id: "r1", entry: { a: 1 } },
          { id: "r2", entry: { a: 2 } },
        ],
        1: [
          { id: "r3", entry: { a: 3 } },
          { id: "r4", entry: { a: 4 } },
        ],
      });

      const result = await getFullDataset({
        datasetId: "dataset_1",
        projectId: "p1",
        entrySelection: "first",
      });

      // Only chunk 0 read; whole-dataset readChunks never touched.
      expect(readChunk).toHaveBeenCalledWith({
        projectId: "p1",
        datasetId: "dataset_1",
        index: 0,
      });
      expect(readChunks).not.toHaveBeenCalled();
      expect(result?.datasetRecords).toHaveLength(1);
      expect(result?.datasetRecords[0]?.id).toBe("r1");
      expect(result?.count).toBe(4);
    });
  });

  describe("when an entrySelection of 'last' is requested", () => {
    it("reads only the last chunk and returns its last row", async () => {
      findFirst.mockResolvedValue({ ...twoChunkDataset });
      const { readChunks, readChunk } = mockReadChunk({
        0: [
          { id: "r1", entry: { a: 1 } },
          { id: "r2", entry: { a: 2 } },
        ],
        1: [
          { id: "r3", entry: { a: 3 } },
          { id: "r4", entry: { a: 4 } },
        ],
      });

      const result = await getFullDataset({
        datasetId: "dataset_1",
        projectId: "p1",
        entrySelection: "last",
      });

      expect(readChunk).toHaveBeenCalledWith({
        projectId: "p1",
        datasetId: "dataset_1",
        index: 1,
      });
      expect(readChunks).not.toHaveBeenCalled();
      expect(result?.datasetRecords).toHaveLength(1);
      expect(result?.datasetRecords[0]?.id).toBe("r4");
    });
  });

  describe("when an entrySelection of a row number in the second chunk is requested", () => {
    it("reads only the chunk whose range contains the row and returns it", async () => {
      findFirst.mockResolvedValue({ ...twoChunkDataset });
      const { readChunks, readChunk } = mockReadChunk({
        0: [
          { id: "r1", entry: { a: 1 } },
          { id: "r2", entry: { a: 2 } },
        ],
        1: [
          { id: "r3", entry: { a: 3 } },
          { id: "r4", entry: { a: 4 } },
        ],
      });

      // Global row 2 → chunk 1 (range [2,4)), local index 0 → r3.
      const result = await getFullDataset({
        datasetId: "dataset_1",
        projectId: "p1",
        entrySelection: 2,
      });

      expect(readChunk).toHaveBeenCalledWith({
        projectId: "p1",
        datasetId: "dataset_1",
        index: 1,
      });
      expect(readChunks).not.toHaveBeenCalled();
      expect(result?.datasetRecords).toHaveLength(1);
      expect(result?.datasetRecords[0]?.id).toBe("r3");
    });
  });

  describe("when an entrySelection of 'all' is requested", () => {
    it("reads chunks incrementally (one at a time), never the whole-dataset readChunks", async () => {
      findFirst.mockResolvedValue({ ...twoChunkDataset });
      const { readChunks, readChunk } = mockReadChunk({
        0: [
          { id: "r1", entry: { a: 1 } },
          { id: "r2", entry: { a: 2 } },
        ],
        1: [
          { id: "r3", entry: { a: 3 } },
          { id: "r4", entry: { a: 4 } },
        ],
      });

      const result = await getFullDataset({
        datasetId: "dataset_1",
        projectId: "p1",
        entrySelection: "all",
      });

      // Incremental: readChunk per index; whole-dataset readChunks never used.
      expect(readChunk).toHaveBeenCalledTimes(2);
      expect(readChunk).toHaveBeenNthCalledWith(1, {
        projectId: "p1",
        datasetId: "dataset_1",
        index: 0,
      });
      expect(readChunk).toHaveBeenNthCalledWith(2, {
        projectId: "p1",
        datasetId: "dataset_1",
        index: 1,
      });
      expect(readChunks).not.toHaveBeenCalled();
      expect(result?.datasetRecords).toHaveLength(4);
      expect(result?.count).toBe(4);
    });
  });

  // P1#2 — getAll (limitMb 5) on a multi-chunk dataset must STOP reading once
  // the byte budget is reached and never touch the remaining chunks (I-MEM).
  describe("when 'all' exceeds the byte budget partway through the chunks", () => {
    it("stops reading after the limit and does NOT read chunks beyond the budget", async () => {
      // Two chunks; chunk 0 alone overflows the 1 MB budget, so chunk 1 must
      // never be read.
      const bigEntry = "x".repeat(1_200_000); // ~1.2 MB JSON string
      findFirst.mockResolvedValue({ ...twoChunkDataset });
      const { readChunks, readChunk } = mockReadChunk({
        0: [
          { id: "r1", entry: { a: bigEntry } },
          { id: "r2", entry: { a: bigEntry } },
        ],
        1: [
          { id: "r3", entry: { a: 3 } },
          { id: "r4", entry: { a: 4 } },
        ],
      });

      const result = await getFullDataset({
        datasetId: "dataset_1",
        projectId: "p1",
        entrySelection: "all",
        limitMb: 1,
      });

      // Chunk 0 read; chunk 1 NEVER read (budget hit).
      expect(readChunk).toHaveBeenCalledWith({
        projectId: "p1",
        datasetId: "dataset_1",
        index: 0,
      });
      expect(readChunk).not.toHaveBeenCalledWith({
        projectId: "p1",
        datasetId: "dataset_1",
        index: 1,
      });
      expect(readChunks).not.toHaveBeenCalled();
      expect(result?.truncated).toBe(true);
      // count stays PG-authoritative even though we stopped early.
      expect(result?.count).toBe(4);
    });
  });

  // P1#2 — a full export (limitMb: null) of a dataset over the safe ceiling must
  // throw a clear typed error rather than materialize GBs in heap.
  describe("when a full export would exceed the safe in-heap ceiling", () => {
    it("throws DatasetTooLargeToExportError without reading any chunk", async () => {
      findFirst.mockResolvedValue({
        ...twoChunkDataset,
        sizeBytes: BigInt(200 * 1024 * 1024), // 200 MB > 100 MB ceiling
      });
      const { readChunks, readChunk } = mockReadChunk({});

      await expect(
        getFullDataset({
          datasetId: "dataset_1",
          projectId: "p1",
          entrySelection: "all",
          limitMb: null,
        }),
      ).rejects.toMatchObject({ name: "DatasetTooLargeToExportError" });
      expect(readChunk).not.toHaveBeenCalled();
      expect(readChunks).not.toHaveBeenCalled();
    });
  });

  describe("when a full export is within the safe ceiling", () => {
    it("reads chunks incrementally and returns every row", async () => {
      findFirst.mockResolvedValue({
        ...twoChunkDataset,
        sizeBytes: BigInt(1024),
      });
      const { readChunk } = mockReadChunk({
        0: [
          { id: "r1", entry: { a: 1 } },
          { id: "r2", entry: { a: 2 } },
        ],
        1: [
          { id: "r3", entry: { a: 3 } },
          { id: "r4", entry: { a: 4 } },
        ],
      });

      const result = await getFullDataset({
        datasetId: "dataset_1",
        projectId: "p1",
        entrySelection: "all",
        limitMb: null,
      });

      expect(readChunk).toHaveBeenCalledTimes(2);
      expect(result?.datasetRecords).toHaveLength(4);
      expect(result?.truncated).toBe(false);
    });
  });

  describe("when a single-row selection is requested but chunkOffsets are missing", () => {
    it("falls back to the full read instead of serving nothing", async () => {
      findFirst.mockResolvedValue({
        ...baseDataset,
        rowCount: 2,
        chunkCount: 1,
        chunkOffsets: null,
      });
      const { readChunks, readChunk } = mockReadChunk({});
      readChunks.mockResolvedValue([
        { id: "r1", entry: { a: 1 } },
        { id: "r2", entry: { a: 2 } },
      ]);

      const result = await getFullDataset({
        datasetId: "dataset_1",
        projectId: "p1",
        entrySelection: "first",
      });

      // No offsets → no short-circuit; full read drives the selection.
      expect(readChunk).not.toHaveBeenCalled();
      expect(readChunks).toHaveBeenCalled();
      expect(result?.datasetRecords).toHaveLength(1);
      expect(result?.datasetRecords[0]?.id).toBe("r1");
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
    it("reads the first non-empty chunk and returns up to 5 adapted rows with the PG count", async () => {
      const { readChunks, readChunk } = mockReadChunk({
        0: [
          { id: "r1", entry: { a: 1 } },
          { id: "r2", entry: { a: 2 } },
        ],
      });

      const result = await readDatasetHeadS3Jsonl({
        dataset: {
          ...baseDataset,
          rowCount: 2,
          chunkCount: 1,
          chunkOffsets: [{ index: 0, startRow: 0, endRow: 2, byteSize: 10 }],
        } as never,
        projectId: "p1",
      });

      // Reads the single non-empty chunk; never the whole-dataset readChunks.
      expect(readChunk).toHaveBeenCalledTimes(1);
      expect(readChunk).toHaveBeenCalledWith({
        projectId: "p1",
        datasetId: "dataset_1",
        index: 0,
      });
      expect(readChunks).not.toHaveBeenCalled();
      expect(result.total).toBe(2); // PG-authoritative rowCount
      expect(result.records.map((r) => r.id)).toEqual(["r1", "r2"]);
      expect(result.records[0]?.entry).toEqual({ a: 1 });
    });
  });

  describe("when a delete emptied the leading chunk but later chunks still have rows", () => {
    it("skips the empty chunk via the offset index and previews the first non-empty chunk", async () => {
      // chunk 0 emptied in place by a delete (compaction is trailing-only, so a
      // leading empty chunk stays); the surviving rows now live in chunk 1.
      const { readChunk } = mockReadChunk({
        0: [],
        1: [
          { id: "r3", entry: { a: 3 } },
          { id: "r4", entry: { a: 4 } },
        ],
      });

      const result = await readDatasetHeadS3Jsonl({
        dataset: {
          ...baseDataset,
          rowCount: 2,
          chunkCount: 2,
          chunkOffsets: [
            { index: 0, startRow: 0, endRow: 0, byteSize: 0 },
            { index: 1, startRow: 0, endRow: 2, byteSize: 50 },
          ],
        } as never,
        projectId: "p1",
      });

      // The empty leading chunk is skipped WITHOUT a read; only chunk 1 read.
      expect(readChunk).toHaveBeenCalledTimes(1);
      expect(readChunk).toHaveBeenCalledWith({
        projectId: "p1",
        datasetId: "dataset_1",
        index: 1,
      });
      // The bug: an empty preview against a positive total. Now non-empty.
      expect(result.records.map((r) => r.id)).toEqual(["r3", "r4"]);
      expect(result.total).toBe(2);
    });
  });

  describe("when the offset index is missing (legacy rows)", () => {
    it("scans chunks in order, skipping empties, until the preview is filled", async () => {
      const { readChunk } = mockReadChunk({
        0: [],
        1: [{ id: "r5", entry: { a: 5 } }],
      });

      const result = await readDatasetHeadS3Jsonl({
        dataset: {
          ...baseDataset,
          rowCount: 1,
          chunkCount: 2,
          chunkOffsets: null,
        } as never,
        projectId: "p1",
      });

      expect(readChunk).toHaveBeenNthCalledWith(1, {
        projectId: "p1",
        datasetId: "dataset_1",
        index: 0,
      });
      expect(readChunk).toHaveBeenNthCalledWith(2, {
        projectId: "p1",
        datasetId: "dataset_1",
        index: 1,
      });
      expect(result.records.map((r) => r.id)).toEqual(["r5"]);
      expect(result.total).toBe(1);
    });
  });

  describe("when the dataset is not ready", () => {
    it("throws DatasetNotReadyError without reading chunks", async () => {
      const { readChunk } = mockReadChunk({});

      await expect(
        readDatasetHeadS3Jsonl({
          dataset: { ...baseDataset, status: "failed" } as never,
          projectId: "p1",
        }),
      ).rejects.toMatchObject({
        name: "DatasetNotReadyError",
        status: "failed",
      });
      expect(readChunk).not.toHaveBeenCalled();
    });
  });
});
