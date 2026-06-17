import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toJsonlChunks } from "../dataset-chunking";
import {
  createDatasetNormalizeHandler,
  datasetNormalizeDedupId,
} from "../dataset-normalize.job";

/**
 * Unit test the normalize handler at its boundaries: a fake `DatasetStorage`
 * (streamStaged → Readable.from(...), writeChunks / deleteStaged spies) and a
 * stub `DatasetRepository`. The streaming parse + chunk-writer logic under test
 * stays real.
 */

const makeStorage = (overrides: Record<string, unknown> = {}) => {
  const writeChunks = vi.fn(
    async ({
      records,
      fromIndex = 0,
    }: {
      records: unknown[];
      fromIndex?: number;
    }) =>
      toJsonlChunks(records).map((c) => ({ ...c, index: c.index + fromIndex })),
  );
  const deleteStaged = vi.fn().mockResolvedValue(undefined);
  const headStagedObjectSize = vi.fn().mockResolvedValue(1024);
  return {
    storage: {
      writeChunks,
      deleteStaged,
      headStagedObjectSize,
      streamStaged: vi.fn(),
      readChunks: vi.fn(),
      createPresignedUpload: vi.fn(),
      ...overrides,
    },
    writeChunks,
    deleteStaged,
    headStagedObjectSize,
  };
};

const makeRepo = (dataset: Record<string, unknown> | null) => ({
  findOne: vi.fn().mockResolvedValue(dataset),
  update: vi.fn().mockResolvedValue({}),
});

const basePayload = {
  id: "d1",
  tenantId: "p1",
  projectId: "p1",
  datasetId: "d1",
  stagingKey: "staging/p1/u1",
  filename: "data.jsonl",
};

beforeEach(() => vi.clearAllMocks());

describe("datasetNormalizeDedupId()", () => {
  it("keys dedup by datasetId so one normalize runs per dataset", () => {
    expect(datasetNormalizeDedupId(basePayload)).toBe("d1");
  });
});

describe("createDatasetNormalizeHandler()", () => {
  describe("when a processing JSONL dataset normalizes successfully", () => {
    /** @scenario "Both CSV and JSONL files are accepted" */
    it("writes chunks and flips the dataset to ready with counters and columnTypes", async () => {
      const { storage, writeChunks, deleteStaged } = makeStorage({
        streamStaged: vi
          .fn()
          .mockResolvedValue(
            Readable.from(['{"a":"1","b":"x"}\n{"a":"2","b":"y"}\n']),
          ),
      });
      const repo = makeRepo({ id: "d1", status: "processing" });

      const handler = createDatasetNormalizeHandler({
        repository: repo as any,
        getStorage: async () => storage as any,
      });
      await handler(basePayload);

      expect(writeChunks).toHaveBeenCalledTimes(1);
      const update = repo.update.mock.calls[0]![0];
      expect(update.data.status).toBe("ready");
      expect(update.data.rowCount).toBe(2);
      expect(update.data.chunkCount).toBe(1);
      expect(update.data.columnTypes).toEqual([
        { name: "a", type: "string" },
        { name: "b", type: "string" },
      ]);
      expect(typeof update.data.sizeBytes).toBe("bigint");
      expect(deleteStaged).toHaveBeenCalledWith({
        projectId: "p1",
        key: "staging/p1/u1",
      });
    });
  });

  describe("when a CSV dataset normalizes successfully", () => {
    /** @scenario "Both CSV and JSONL files are accepted" */
    it("derives headers from the CSV fields and writes the rows", async () => {
      const { storage, writeChunks } = makeStorage({
        streamStaged: vi
          .fn()
          .mockResolvedValue(Readable.from(["a,b\n1,x\n2,y\n"])),
      });
      const repo = makeRepo({ id: "d1", status: "processing" });

      const handler = createDatasetNormalizeHandler({
        repository: repo as any,
        getStorage: async () => storage as any,
      });
      await handler({ ...basePayload, filename: "data.csv" });

      expect(writeChunks).toHaveBeenCalledTimes(1);
      const update = repo.update.mock.calls[0]![0];
      expect(update.data.status).toBe("ready");
      expect(update.data.rowCount).toBe(2);
      expect(update.data.columnTypes).toEqual([
        { name: "a", type: "string" },
        { name: "b", type: "string" },
      ]);
    });
  });

  describe("when a ready dataset reports its row count and size", () => {
    /** @scenario "A ready dataset reports its true row count and size" */
    it("records the true rowCount and a positive sizeBytes once ready", async () => {
      const rows = Array.from({ length: 50 }, (_, i) => `{"a":"${i}"}`).join(
        "\n",
      );
      const { storage } = makeStorage({
        streamStaged: vi.fn().mockResolvedValue(Readable.from([rows + "\n"])),
      });
      const repo = makeRepo({ id: "d1", status: "processing" });

      const handler = createDatasetNormalizeHandler({
        repository: repo as any,
        getStorage: async () => storage as any,
      });
      await handler(basePayload);

      const update = repo.update.mock.calls[0]![0];
      expect(update.data.status).toBe("ready");
      expect(update.data.rowCount).toBe(50);
      expect(update.data.sizeBytes).toBeGreaterThan(0n);
    });
  });

  describe("when the input spans more than one chunk", () => {
    it("writes more than one chunk object keeping memory bounded", async () => {
      const rows = [
        `{"v":"${"x".repeat(50)}"}`,
        `{"v":"${"y".repeat(50)}"}`,
        `{"v":"${"z".repeat(50)}"}`,
      ].join("\n");
      // A tiny per-call chunk cap forces the writer's single flush to split the
      // buffer into multiple chunk objects — proving the chunk-writer yields >1
      // chunk for input larger than one chunk (the streaming, memory-bounded
      // behaviour the handler depends on).
      const splittingWriteChunks = vi.fn(
        async ({ records, fromIndex = 0 }: any) =>
          toJsonlChunks(records, { maxBytes: 10 }).map((c) => ({
            ...c,
            index: c.index + fromIndex,
          })),
      );
      const { storage } = makeStorage({
        streamStaged: vi.fn().mockResolvedValue(Readable.from([rows + "\n"])),
        writeChunks: splittingWriteChunks,
      });
      const repo = makeRepo({ id: "d1", status: "processing" });

      const handler = createDatasetNormalizeHandler({
        repository: repo as any,
        getStorage: async () => storage as any,
      });
      await handler(basePayload);

      const update = repo.update.mock.calls[0]![0];
      expect(update.data.rowCount).toBe(3);
      expect(update.data.chunkCount).toBeGreaterThan(1);
      expect(splittingWriteChunks).toHaveBeenCalled();
    });
  });

  describe("when parsing fails", () => {
    it("flips the dataset to failed with a statusError, does NOT delete staging, and rethrows", async () => {
      const { storage, deleteStaged } = makeStorage({
        streamStaged: vi
          .fn()
          .mockResolvedValue(Readable.from(["{not valid json\n"])),
      });
      const repo = makeRepo({ id: "d1", status: "processing" });

      const handler = createDatasetNormalizeHandler({
        repository: repo as any,
        getStorage: async () => storage as any,
      });

      await expect(handler(basePayload)).rejects.toThrow();
      const update = repo.update.mock.calls[0]![0];
      expect(update.data.status).toBe("failed");
      expect(update.data.statusError).toBeTruthy();
      expect(deleteStaged).not.toHaveBeenCalled();
    });
  });

  describe("when the dataset is not in processing", () => {
    it("no-ops without touching storage (idempotent re-drive guard)", async () => {
      const { storage } = makeStorage({
        streamStaged: vi.fn(),
      });
      const repo = makeRepo({ id: "d1", status: "ready" });

      const handler = createDatasetNormalizeHandler({
        repository: repo as any,
        getStorage: async () => storage as any,
      });
      await handler(basePayload);

      expect(storage.streamStaged).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  describe("when the dataset row no longer exists", () => {
    it("no-ops", async () => {
      const { storage } = makeStorage({ streamStaged: vi.fn() });
      const repo = makeRepo(null);

      const handler = createDatasetNormalizeHandler({
        repository: repo as any,
        getStorage: async () => storage as any,
      });
      await handler(basePayload);

      expect(storage.streamStaged).not.toHaveBeenCalled();
    });
  });

  describe("when a .json file exceeds the large-json cap", () => {
    it("fails the dataset with a convert-to-JSONL statusError", async () => {
      const { storage } = makeStorage({
        headStagedObjectSize: vi.fn().mockResolvedValue(200 * 1024 * 1024),
        streamStaged: vi.fn().mockResolvedValue(Readable.from(["[]"])),
      });
      const repo = makeRepo({ id: "d1", status: "processing" });

      const handler = createDatasetNormalizeHandler({
        repository: repo as any,
        getStorage: async () => storage as any,
      });

      await expect(
        handler({ ...basePayload, filename: "big.json" }),
      ).rejects.toThrow(/JSONL/i);
      const update = repo.update.mock.calls[0]![0];
      expect(update.data.status).toBe("failed");
    });
  });
});
