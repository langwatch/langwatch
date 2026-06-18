import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toJsonlChunks } from "../dataset-chunking";
import { createDatasetNormalizeHandler } from "../dataset-normalize.job";

/**
 * Unit test the normalize handler at its boundaries: a fake `DatasetStorage`
 * (streamStaged → Readable.from(...), writeChunks / deleteStaged /
 * deleteChunksFrom spies) and a stub `DatasetRepository`. The streaming parse +
 * chunk-writer logic under test stays real.
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
  const deleteChunksFrom = vi.fn().mockResolvedValue(undefined);
  const headStagedObjectSize = vi.fn().mockResolvedValue(1024);
  return {
    storage: {
      writeChunks,
      deleteStaged,
      deleteChunksFrom,
      headStagedObjectSize,
      streamStaged: vi.fn(),
      readChunks: vi.fn(),
      createPresignedUpload: vi.fn(),
      ...overrides,
    },
    writeChunks,
    deleteStaged,
    deleteChunksFrom,
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

describe("createDatasetNormalizeHandler()", () => {
  describe("when a processing JSONL dataset normalizes successfully", () => {
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

  // @regression P1#1 — the streaming writer must accumulate ONLY lightweight
  // per-chunk metadata after each flush, never the chunk `jsonl` payloads
  // (I-MEM). A 2–5 GB upload would otherwise hoard the whole normalized file in
  // heap by finalize. Heap proxy: the meta the handler persists carries chunk
  // offsets (metadata) and NO `jsonl` field anywhere, and the counts still match.
  describe("when the input spans many chunks (memory contract)", () => {
    it("persists chunk metadata only — no jsonl payloads retained — with matching counts", async () => {
      const rows = Array.from(
        { length: 6 },
        (_, i) => `{"v":"${String(i).repeat(40)}"}`,
      ).join("\n");
      // Tiny per-flush cap so the single flush splits into several chunk objects.
      const { storage } = makeStorage({
        streamStaged: vi.fn().mockResolvedValue(Readable.from([rows + "\n"])),
        writeChunks: vi.fn(async ({ records, fromIndex = 0 }: any) =>
          toJsonlChunks(records, { maxBytes: 10 }).map((c) => ({
            ...c,
            index: c.index + fromIndex,
          })),
        ),
      });
      const repo = makeRepo({ id: "d1", status: "processing" });

      const handler = createDatasetNormalizeHandler({
        repository: repo as any,
        getStorage: async () => storage as any,
      });
      await handler(basePayload);

      const update = repo.update.mock.calls[0]![0];
      // Counts still correct.
      expect(update.data.rowCount).toBe(6);
      expect(update.data.chunkCount).toBeGreaterThan(1);
      // Metadata persisted; NO `jsonl` payload anywhere in what the handler kept.
      const offsets = update.data.chunkOffsets as Array<
        Record<string, unknown>
      >;
      expect(offsets).toHaveLength(update.data.chunkCount);
      for (const offset of offsets) {
        expect(offset).not.toHaveProperty("jsonl");
        expect(offset).toMatchObject({
          index: expect.any(Number),
          startRow: expect.any(Number),
          endRow: expect.any(Number),
          byteSize: expect.any(Number),
        });
      }
      // The whole persisted payload must not carry any serialized chunk body
      // (BigInt-safe stringify since `sizeBytes` is a bigint).
      const serialized = JSON.stringify(update.data, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value,
      );
      expect(serialized).not.toContain("jsonl");
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

  describe("when a record carries a reserved column name", () => {
    it("renames the key in stored rows and columnTypes (id → id_)", async () => {
      const { storage, writeChunks } = makeStorage({
        streamStaged: vi
          .fn()
          .mockResolvedValue(Readable.from(['{"id":"x","b":"y"}\n'])),
      });
      const repo = makeRepo({ id: "d1", status: "processing" });

      const handler = createDatasetNormalizeHandler({
        repository: repo as any,
        getStorage: async () => storage as any,
      });
      await handler(basePayload);

      // The stored row's keys are rewritten so they match columnTypes. Each
      // line is wrapped as { id, entry } so a later edit/delete can target the
      // row by id.
      const pushed = writeChunks.mock.calls[0]![0].records as Array<{
        id: string;
        entry: Record<string, unknown>;
      }>;
      expect(pushed).toHaveLength(1);
      expect(pushed[0]!.id).toMatch(/^record_/);
      expect(pushed[0]!.entry).toEqual({ id_: "x", b: "y" });
      const update = repo.update.mock.calls[0]![0];
      expect(update.data.columnTypes).toEqual([
        { name: "id_", type: "string" },
        { name: "b", type: "string" },
      ]);
    });
  });

  describe("when the uploaded file has no rows", () => {
    it("fails the dataset with an empty-file statusError instead of flipping to ready", async () => {
      const { storage } = makeStorage({
        streamStaged: vi.fn().mockResolvedValue(Readable.from(["\n  \n"])),
      });
      const repo = makeRepo({ id: "d1", status: "processing" });

      const handler = createDatasetNormalizeHandler({
        repository: repo as any,
        getStorage: async () => storage as any,
      });

      await expect(handler(basePayload)).rejects.toThrow(/empty/i);
      const update = repo.update.mock.calls[0]![0];
      expect(update.data.status).toBe("failed");
      expect(update.data.statusError).toMatch(/empty/i);
    });
  });

  describe("when a JSONL line exceeds the max line size", () => {
    it("fails the dataset rather than buffering an unbounded line", async () => {
      const giant = `{"a":"${"x".repeat(9 * 1024 * 1024)}"}\n`;
      const { storage } = makeStorage({
        streamStaged: vi.fn().mockResolvedValue(Readable.from([giant])),
      });
      const repo = makeRepo({ id: "d1", status: "processing" });

      const handler = createDatasetNormalizeHandler({
        repository: repo as any,
        getStorage: async () => storage as any,
      });

      await expect(handler(basePayload)).rejects.toThrow(/max size|malformed/i);
      const update = repo.update.mock.calls[0]![0];
      expect(update.data.status).toBe("failed");
    });
  });

  // @regression — a re-drive that writes fewer chunks than a crashed prior run
  // leaves orphan chunk objects; the handler must delete them from the new
  // chunk count upward so the chunk set matches the PG counters (I-IDEM).
  describe("when a prior run left more chunks than this run writes", () => {
    it("deletes orphan chunks from the final count and stops at the first gap", async () => {
      const { storage, deleteChunksFrom } = makeStorage({
        // This run writes exactly 2 chunks (tiny per-chunk cap splits the rows).
        writeChunks: vi.fn(async ({ records, fromIndex = 0 }: any) =>
          toJsonlChunks(records, { maxBytes: 10 }).map((c) => ({
            ...c,
            index: c.index + fromIndex,
          })),
        ),
        streamStaged: vi
          .fn()
          .mockResolvedValue(
            Readable.from(['{"v":"aaaaaaaa"}\n{"v":"bbbbbbbb"}\n']),
          ),
      });
      const repo = makeRepo({ id: "d1", status: "processing" });

      const handler = createDatasetNormalizeHandler({
        repository: repo as any,
        getStorage: async () => storage as any,
      });
      await handler(basePayload);

      const update = repo.update.mock.calls[0]![0];
      // deleteChunksFrom is called with fromIndex === this run's chunk count, so
      // any orphan at that index or beyond is reaped (the impl stops at the
      // first missing index).
      expect(deleteChunksFrom).toHaveBeenCalledWith({
        projectId: "p1",
        datasetId: "d1",
        fromIndex: update.data.chunkCount,
      });
    });
  });
});
