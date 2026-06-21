import type { Dataset } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  appendS3JsonlRecords,
  deleteS3JsonlRecords,
  editS3JsonlRecord,
  recomputeDatasetCounts,
} from "../dataset-mutations";
import { MissingChunkError } from "../errors";

/**
 * Unit tests for the s3_jsonl write-mutations (ADR-032 rung 6b). Boundary mocks:
 * the `DatasetStorage` (chunk I/O) is a fake passed in via `storage`, and the
 * Prisma client is stubbed at the `$transaction` / advisory-lock seam. The
 * counter math + offset recomputation under test stay real.
 */

/** A fake `Dataset` row carrying just the fields the mutations read. */
const makeDataset = (overrides: Partial<Dataset> = {}): Dataset =>
  ({
    id: "dataset_1",
    projectId: "p1",
    name: "DS",
    slug: "ds",
    contentLayout: "s3_jsonl",
    status: "ready",
    statusError: null,
    rowCount: 0,
    sizeBytes: 0n,
    chunkCount: 0,
    chunkOffsets: [],
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
    ...overrides,
  }) as unknown as Dataset;

/**
 * A Prisma stub whose `$transaction(fn)` runs `fn` with a tx whose
 * `dataset.findFirstOrThrow` returns `row` and whose `dataset.update` is a spy.
 * `$executeRaw` is the advisory-lock seam — spied so a test can assert the lock
 * was taken. Returns the spies for assertions.
 */
const makePrisma = (row: Dataset) => {
  const update = vi.fn().mockResolvedValue(undefined);
  const findFirstOrThrow = vi.fn().mockResolvedValue(row);
  const executeRaw = vi.fn().mockResolvedValue([]);
  const tx = {
    $executeRaw: executeRaw,
    dataset: { findFirstOrThrow, update },
  };
  const prisma = {
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  return { prisma, tx, update, findFirstOrThrow, executeRaw };
};

/** A storage fake with controllable chunk I/O spies. */
const makeStorage = (
  overrides: Partial<{
    writeChunks: ReturnType<typeof vi.fn>;
    readChunk: ReturnType<typeof vi.fn>;
    rewriteChunk: ReturnType<typeof vi.fn>;
    deleteChunksFrom: ReturnType<typeof vi.fn>;
  }> = {},
) => ({
  writeChunks: vi.fn(),
  readChunk: vi.fn(),
  rewriteChunk: vi.fn(),
  deleteChunksFrom: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

beforeEach(() => vi.clearAllMocks());

describe("dataset-mutations (s3_jsonl)", () => {
  describe("appendS3JsonlRecords()", () => {
    describe("when appending rows to a ready dataset with one existing chunk", () => {
      it("writes a new chunk from chunkCount with {id,entry}-wrapped rows and advances the counters", async () => {
        const row = makeDataset({
          rowCount: 10,
          sizeBytes: 100n,
          chunkCount: 1,
          chunkOffsets: [
            { index: 0, startRow: 0, endRow: 10, byteSize: 100 },
          ] as unknown as Dataset["chunkOffsets"],
        });
        const { prisma, update, executeRaw } = makePrisma(row);
        const storage = makeStorage({
          writeChunks: vi
            .fn()
            .mockResolvedValue([
              { index: 1, rowCount: 2, byteSize: 40, startRow: 0, endRow: 2 },
            ]),
        });

        const result = await appendS3JsonlRecords({
          prisma: prisma as never,
          dataset: row,
          projectId: "p1",
          entries: [{ a: 1 }, { a: 2 }],
          storage: storage as never,
        });

        expect(result).toEqual({ appended: 2 });
        // Advisory lock taken inside the transaction.
        expect(executeRaw).toHaveBeenCalledOnce();
        // Appends from the existing chunkCount, never overwriting chunk 0.
        const writeArgs = storage.writeChunks.mock.calls[0]![0];
        expect(writeArgs.fromIndex).toBe(1);
        // Each row wrapped as { id, entry }.
        expect(writeArgs.records).toEqual([
          { id: expect.stringMatching(/^record_/), entry: { a: 1 } },
          { id: expect.stringMatching(/^record_/), entry: { a: 2 } },
        ]);
        // Counters: rowCount += 2, sizeBytes += 40, chunkCount = 2, offsets
        // extended with the new chunk's startRow offset by the old rowCount.
        expect(update.mock.calls[0]![0].data).toEqual({
          rowCount: 12,
          sizeBytes: 140n,
          chunkCount: 2,
          chunkOffsets: [
            { index: 0, startRow: 0, endRow: 10, byteSize: 100 },
            { index: 1, startRow: 10, endRow: 12, byteSize: 40 },
          ],
        });
      });
    });

    describe("when the dataset is not ready", () => {
      it("throws DatasetNotReadyError and never writes a chunk", async () => {
        const row = makeDataset({ status: "processing" });
        const { prisma } = makePrisma(row);
        const storage = makeStorage();

        await expect(
          appendS3JsonlRecords({
            prisma: prisma as never,
            dataset: row,
            projectId: "p1",
            entries: [{ a: 1 }],
            storage: storage as never,
          }),
        ).rejects.toMatchObject({ name: "DatasetNotReadyError" });
        expect(storage.writeChunks).not.toHaveBeenCalled();
      });
    });
  });

  describe("editS3JsonlRecord()", () => {
    describe("when the row id is found in the second chunk", () => {
      it("rewrites only that chunk with the entry replaced, updates sizeBytes, leaves rowCount", async () => {
        const row = makeDataset({
          rowCount: 4,
          sizeBytes: 200n,
          chunkCount: 2,
          chunkOffsets: [
            { index: 0, startRow: 0, endRow: 2, byteSize: 100 },
            { index: 1, startRow: 2, endRow: 4, byteSize: 100 },
          ] as unknown as Dataset["chunkOffsets"],
        });
        const { prisma, update, executeRaw } = makePrisma(row);
        const readChunk = vi
          .fn()
          .mockResolvedValueOnce([
            { id: "r1", entry: { a: 1 } },
            { id: "r2", entry: { a: 2 } },
          ])
          .mockResolvedValueOnce([
            { id: "r3", entry: { a: 3 } },
            { id: "r4", entry: { a: 4 } },
          ]);
        const rewriteChunk = vi.fn().mockResolvedValue({
          index: 1,
          startRow: 0,
          endRow: 2,
          byteSize: 130,
        });
        const storage = makeStorage({ readChunk, rewriteChunk });

        const result = await editS3JsonlRecord({
          prisma: prisma as never,
          dataset: row,
          projectId: "p1",
          recordId: "r3",
          entry: { a: 99 },
          storage: storage as never,
        });

        expect(result).toEqual({ updated: true });
        expect(executeRaw).toHaveBeenCalledOnce();
        // Scanned chunk 0 then chunk 1; rewrote ONLY chunk 1 with r3 replaced.
        expect(readChunk).toHaveBeenCalledTimes(2);
        expect(rewriteChunk).toHaveBeenCalledOnce();
        expect(rewriteChunk.mock.calls[0]![0]).toMatchObject({
          index: 1,
          records: [
            { id: "r3", entry: { a: 99 } },
            { id: "r4", entry: { a: 4 } },
          ],
        });
        // sizeBytes shifts by the chunk byte delta (130 - 100 = +30); rowCount
        // and chunkCount untouched.
        expect(update.mock.calls[0]![0].data).toEqual({
          sizeBytes: 230n,
          chunkOffsets: [
            { index: 0, startRow: 0, endRow: 2, byteSize: 100 },
            { index: 1, startRow: 2, endRow: 4, byteSize: 130 },
          ],
        });
      });
    });

    describe("when the row id is not found in any chunk", () => {
      it("appends it as a new row pinned to the requested id", async () => {
        const row = makeDataset({
          rowCount: 1,
          sizeBytes: 50n,
          chunkCount: 1,
          chunkOffsets: [
            { index: 0, startRow: 0, endRow: 1, byteSize: 50 },
          ] as unknown as Dataset["chunkOffsets"],
        });
        const { prisma, update } = makePrisma(row);
        const readChunk = vi
          .fn()
          .mockResolvedValue([{ id: "r1", entry: { a: 1 } }]);
        const writeChunks = vi
          .fn()
          .mockResolvedValue([
            { index: 1, rowCount: 1, byteSize: 30, startRow: 0, endRow: 1 },
          ]);
        const rewriteChunk = vi.fn();
        const storage = makeStorage({ readChunk, writeChunks, rewriteChunk });

        const result = await editS3JsonlRecord({
          prisma: prisma as never,
          dataset: row,
          projectId: "p1",
          recordId: "new_id",
          entry: { a: 2 },
          storage: storage as never,
        });

        expect(result).toEqual({ updated: false });
        expect(rewriteChunk).not.toHaveBeenCalled();
        // Appended with the requested id pinned (upsert-of-new).
        expect(writeChunks.mock.calls[0]![0].records).toEqual([
          { id: "new_id", entry: { a: 2 } },
        ]);
        expect(update.mock.calls[0]![0].data).toMatchObject({
          rowCount: 2,
          chunkCount: 2,
        });
      });
    });

    // C1: an S3 rewrite failure throws out of the advisory-locked $transaction,
    // so the PG counter update never runs → the throw rolls PG back cleanly. The
    // residual (PG-commit failure AFTER the S3 write) is repaired by
    // recomputeDatasetCounts; this guards the common S3-fails-first direction.
    describe("when the S3 rewriteChunk fails mid-edit", () => {
      it("propagates the error and never commits the PG counter update", async () => {
        const row = makeDataset({
          rowCount: 2,
          sizeBytes: 100n,
          chunkCount: 1,
          chunkOffsets: [
            { index: 0, startRow: 0, endRow: 2, byteSize: 100 },
          ] as unknown as Dataset["chunkOffsets"],
        });
        const { prisma, update } = makePrisma(row);
        const readChunk = vi.fn().mockResolvedValue([
          { id: "r1", entry: { a: 1 } },
          { id: "r2", entry: { a: 2 } },
        ]);
        const rewriteChunk = vi
          .fn()
          .mockRejectedValue(new Error("S3 PutObject failed"));
        const storage = makeStorage({ readChunk, rewriteChunk });

        await expect(
          editS3JsonlRecord({
            prisma: prisma as never,
            dataset: row,
            projectId: "p1",
            recordId: "r1",
            entry: { a: 99 },
            storage: storage as never,
          }),
        ).rejects.toThrow("S3 PutObject failed");
        // Counters never touched — the throw rolled the transaction back.
        expect(update).not.toHaveBeenCalled();
      });
    });
  });

  describe("deleteS3JsonlRecords()", () => {
    describe("when deleting a row from the first of two chunks", () => {
      it("rewrites only that chunk without the row and shifts the trailing offsets down", async () => {
        const row = makeDataset({
          rowCount: 4,
          sizeBytes: 200n,
          chunkCount: 2,
          chunkOffsets: [
            { index: 0, startRow: 0, endRow: 2, byteSize: 100 },
            { index: 1, startRow: 2, endRow: 4, byteSize: 100 },
          ] as unknown as Dataset["chunkOffsets"],
        });
        const { prisma, update, executeRaw } = makePrisma(row);
        const readChunk = vi
          .fn()
          .mockResolvedValueOnce([
            { id: "r1", entry: { a: 1 } },
            { id: "r2", entry: { a: 2 } },
          ])
          .mockResolvedValueOnce([
            { id: "r3", entry: { a: 3 } },
            { id: "r4", entry: { a: 4 } },
          ]);
        // chunk 0 rewritten without r1 → one row, 55 bytes.
        const rewriteChunk = vi.fn().mockResolvedValue({
          index: 0,
          startRow: 0,
          endRow: 1,
          byteSize: 55,
        });
        const storage = makeStorage({ readChunk, rewriteChunk });

        const result = await deleteS3JsonlRecords({
          prisma: prisma as never,
          dataset: row,
          projectId: "p1",
          recordIds: ["r1"],
          storage: storage as never,
        });

        expect(result).toEqual({ deleted: 1 });
        expect(executeRaw).toHaveBeenCalledOnce();
        // Only chunk 0 (the affected one) is rewritten; chunk 1 is left alone.
        expect(rewriteChunk).toHaveBeenCalledOnce();
        expect(rewriteChunk.mock.calls[0]![0]).toMatchObject({
          index: 0,
          records: [{ id: "r2", entry: { a: 2 } }],
        });
        const data = update.mock.calls[0]![0].data;
        // rowCount drops by 1; chunkCount stays (empty chunks kept, no compaction).
        expect(data.rowCount).toBe(3);
        expect(data.chunkCount).toBeUndefined();
        // Chunk 0 now holds 1 row → chunk 1's startRow/endRow shift down by 1.
        // m1: pin the untouched chunk's concrete recomputed byteSize (56 =
        // toSingleJsonl([r3,r4])) so any count-drift on the untouched chunk
        // would fail the test, not pass under expect.any(Number).
        expect(data.chunkOffsets).toEqual([
          { index: 0, startRow: 0, endRow: 1, byteSize: 55 },
          { index: 1, startRow: 1, endRow: 3, byteSize: 56 },
        ]);
      });
    });

    describe("when every row in a NON-TRAILING chunk is deleted", () => {
      it("leaves the middle chunk in place as empty (startRow===endRow), chunkCount unchanged, no trim", async () => {
        const row = makeDataset({
          rowCount: 4,
          sizeBytes: 200n,
          chunkCount: 2,
          chunkOffsets: [
            { index: 0, startRow: 0, endRow: 2, byteSize: 100 },
            { index: 1, startRow: 2, endRow: 4, byteSize: 100 },
          ] as unknown as Dataset["chunkOffsets"],
        });
        const { prisma, update } = makePrisma(row);
        const readChunk = vi
          .fn()
          .mockResolvedValueOnce([
            { id: "r1", entry: { a: 1 } },
            { id: "r2", entry: { a: 2 } },
          ])
          .mockResolvedValueOnce([
            { id: "r3", entry: { a: 3 } },
            { id: "r4", entry: { a: 4 } },
          ]);
        // chunk 0 emptied → rewritten with zero rows, 0 bytes.
        const rewriteChunk = vi.fn().mockResolvedValue({
          index: 0,
          startRow: 0,
          endRow: 0,
          byteSize: 0,
        });
        const storage = makeStorage({ readChunk, rewriteChunk });

        const result = await deleteS3JsonlRecords({
          prisma: prisma as never,
          dataset: row,
          projectId: "p1",
          recordIds: ["r1", "r2"],
          storage: storage as never,
        });

        expect(result).toEqual({ deleted: 2 });
        // chunk 0 rewritten with an empty record set; chunk 1 left alone.
        expect(rewriteChunk).toHaveBeenCalledOnce();
        expect(rewriteChunk.mock.calls[0]![0]).toMatchObject({
          index: 0,
          records: [],
        });
        const data = update.mock.calls[0]![0].data;
        expect(data.rowCount).toBe(2);
        // A MIDDLE empty chunk is kept (trailing-only compaction can't remove it
        // without re-indexing the chunks above): chunkCount stays 2, no trim.
        expect(data.chunkCount).toBeUndefined();
        expect(storage.deleteChunksFrom).not.toHaveBeenCalled();
        // The emptied chunk has startRow===endRow (zero rows); chunk 1 shifts to
        // [0, 2). Untouched chunk byteSize pinned (56 = toSingleJsonl([r3,r4])).
        expect(data.chunkOffsets).toEqual([
          { index: 0, startRow: 0, endRow: 0, byteSize: 0 },
          { index: 1, startRow: 0, endRow: 2, byteSize: 56 },
        ]);
      });
    });

    describe("when every row in the TRAILING chunk is deleted", () => {
      it("reaps the trailing empty chunk: deleteChunksFrom + chunkCount decremented + offsets trimmed", async () => {
        const row = makeDataset({
          rowCount: 4,
          sizeBytes: 200n,
          chunkCount: 2,
          chunkOffsets: [
            { index: 0, startRow: 0, endRow: 2, byteSize: 100 },
            { index: 1, startRow: 2, endRow: 4, byteSize: 100 },
          ] as unknown as Dataset["chunkOffsets"],
        });
        const { prisma, update } = makePrisma(row);
        const readChunk = vi
          .fn()
          .mockResolvedValueOnce([
            { id: "r1", entry: { a: 1 } },
            { id: "r2", entry: { a: 2 } },
          ])
          .mockResolvedValueOnce([
            { id: "r3", entry: { a: 3 } },
            { id: "r4", entry: { a: 4 } },
          ]);
        // chunk 1 (the last) emptied → rewritten with zero rows.
        const rewriteChunk = vi
          .fn()
          .mockResolvedValue({ index: 1, startRow: 0, endRow: 0, byteSize: 0 });
        const storage = makeStorage({ readChunk, rewriteChunk });

        const result = await deleteS3JsonlRecords({
          prisma: prisma as never,
          dataset: row,
          projectId: "p1",
          recordIds: ["r3", "r4"],
          storage: storage as never,
        });

        expect(result).toEqual({ deleted: 2 });
        // The trailing empty chunk object is reaped from index 1 upward.
        expect(storage.deleteChunksFrom).toHaveBeenCalledOnce();
        expect(storage.deleteChunksFrom.mock.calls[0]![0]).toMatchObject({
          fromIndex: 1,
        });
        const data = update.mock.calls[0]![0].data;
        expect(data.rowCount).toBe(2);
        // chunkCount decremented; the trailing empty offset entry is dropped.
        expect(data.chunkCount).toBe(1);
        expect(data.chunkOffsets).toEqual([
          { index: 0, startRow: 0, endRow: 2, byteSize: 56 },
        ]);
      });
    });

    describe("when every row in the only chunk is deleted (whole dataset emptied)", () => {
      it("reaps from index 0 so chunkCount goes to 0 with empty offsets", async () => {
        const row = makeDataset({
          rowCount: 2,
          sizeBytes: 100n,
          chunkCount: 1,
          chunkOffsets: [
            { index: 0, startRow: 0, endRow: 2, byteSize: 100 },
          ] as unknown as Dataset["chunkOffsets"],
        });
        const { prisma, update } = makePrisma(row);
        const readChunk = vi.fn().mockResolvedValueOnce([
          { id: "r1", entry: { a: 1 } },
          { id: "r2", entry: { a: 2 } },
        ]);
        const rewriteChunk = vi
          .fn()
          .mockResolvedValue({ index: 0, startRow: 0, endRow: 0, byteSize: 0 });
        const storage = makeStorage({ readChunk, rewriteChunk });

        const result = await deleteS3JsonlRecords({
          prisma: prisma as never,
          dataset: row,
          projectId: "p1",
          recordIds: ["r1", "r2"],
          storage: storage as never,
        });

        expect(result).toEqual({ deleted: 2 });
        expect(storage.deleteChunksFrom.mock.calls[0]![0]).toMatchObject({
          fromIndex: 0,
        });
        const data = update.mock.calls[0]![0].data;
        expect(data.rowCount).toBe(0);
        expect(data.chunkCount).toBe(0);
        expect(data.chunkOffsets).toEqual([]);
      });
    });

    describe("when none of the ids match", () => {
      it("rewrites nothing and reports zero deleted", async () => {
        const row = makeDataset({
          rowCount: 1,
          chunkCount: 1,
          chunkOffsets: [
            { index: 0, startRow: 0, endRow: 1, byteSize: 50 },
          ] as unknown as Dataset["chunkOffsets"],
        });
        const { prisma, update } = makePrisma(row);
        const readChunk = vi
          .fn()
          .mockResolvedValue([{ id: "r1", entry: { a: 1 } }]);
        const rewriteChunk = vi.fn();
        const storage = makeStorage({ readChunk, rewriteChunk });

        const result = await deleteS3JsonlRecords({
          prisma: prisma as never,
          dataset: row,
          projectId: "p1",
          recordIds: ["missing"],
          storage: storage as never,
        });

        expect(result).toEqual({ deleted: 0 });
        expect(rewriteChunk).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
      });
    });

    // C1: same rollback guarantee for delete — an S3 rewrite failure throws out
    // of the $transaction before the counter update, so PG rolls back cleanly.
    describe("when the S3 rewriteChunk fails mid-delete", () => {
      it("propagates the error and never commits the PG counter update", async () => {
        const row = makeDataset({
          rowCount: 2,
          sizeBytes: 100n,
          chunkCount: 1,
          chunkOffsets: [
            { index: 0, startRow: 0, endRow: 2, byteSize: 100 },
          ] as unknown as Dataset["chunkOffsets"],
        });
        const { prisma, update } = makePrisma(row);
        const readChunk = vi.fn().mockResolvedValue([
          { id: "r1", entry: { a: 1 } },
          { id: "r2", entry: { a: 2 } },
        ]);
        const rewriteChunk = vi
          .fn()
          .mockRejectedValue(new Error("S3 PutObject failed"));
        const storage = makeStorage({ readChunk, rewriteChunk });

        await expect(
          deleteS3JsonlRecords({
            prisma: prisma as never,
            dataset: row,
            projectId: "p1",
            recordIds: ["r1"],
            storage: storage as never,
          }),
        ).rejects.toThrow("S3 PutObject failed");
        expect(update).not.toHaveBeenCalled();
      });
    });
  });

  describe("recomputeDatasetCounts()", () => {
    // C1 repair path: re-derive PG counters from S3 truth. Boundary-mock the
    // storage to return known chunks; assert the recomputed rowCount/sizeBytes/
    // chunkCount/chunkOffsets written back match the ACTUAL chunk bytes (the
    // I-COUNT repair for any drift after a PG-commit-after-S3-write failure).
    describe("when the persisted counters have drifted from the chunks on disk", () => {
      it("re-derives rowCount/sizeBytes/chunkOffsets from the actual chunk bytes and writes them back", async () => {
        // The row claims stale/zeroed counters; the real chunks hold 3 rows
        // across 2 chunks. recompute must write the truth, not trust the row.
        const row = makeDataset({
          rowCount: 999,
          sizeBytes: 1n,
          chunkCount: 2,
          chunkOffsets: [] as unknown as Dataset["chunkOffsets"],
        });
        const { prisma, update, executeRaw } = makePrisma(row);
        const readChunk = vi
          .fn()
          .mockResolvedValueOnce([
            { id: "r1", entry: { a: 1 } },
            { id: "r2", entry: { a: 2 } },
          ])
          .mockResolvedValueOnce([{ id: "r3", entry: { a: 3 } }]);
        const storage = makeStorage({ readChunk });

        const result = await recomputeDatasetCounts({
          prisma: prisma as never,
          datasetId: "dataset_1",
          projectId: "p1",
          storage: storage as never,
        });

        // Lock taken; both chunks read to measure their real bytes.
        expect(executeRaw).toHaveBeenCalledOnce();
        expect(readChunk).toHaveBeenCalledTimes(2);

        // Concrete bytes: toSingleJsonl of each chunk's actual rows.
        // chunk 0 = [{r1},{r2}] = 56 bytes; chunk 1 = [{r3}] = 28 bytes.
        const chunk0Bytes = 56;
        const chunk1Bytes = 28;
        const expected = {
          rowCount: 3,
          sizeBytes: chunk0Bytes + chunk1Bytes,
          chunkCount: 2,
          chunkOffsets: [
            { index: 0, startRow: 0, endRow: 2, byteSize: chunk0Bytes },
            { index: 1, startRow: 2, endRow: 3, byteSize: chunk1Bytes },
          ],
        };
        expect(result).toEqual(expected);
        expect(update.mock.calls[0]![0].data).toEqual({
          rowCount: 3,
          sizeBytes: BigInt(chunk0Bytes + chunk1Bytes),
          chunkCount: 2,
          chunkOffsets: expected.chunkOffsets,
        });
      });
    });

    describe("when a trailing chunk object is missing (delete-trim residual)", () => {
      it("re-derives chunkCount from the present prefix instead of throwing", async () => {
        // PG claims 2 chunks but chunk 1 was reaped (the rare PG-commit-after-
        // S3-delete window). recompute must stop at the trailing gap and repair
        // chunkCount to 1, not throw `MissingChunkError`.
        const row = makeDataset({
          rowCount: 4,
          sizeBytes: 200n,
          chunkCount: 2,
          chunkOffsets: [] as unknown as Dataset["chunkOffsets"],
        });
        const { prisma, update } = makePrisma(row);
        const readChunk = vi
          .fn()
          .mockResolvedValueOnce([
            { id: "r1", entry: { a: 1 } },
            { id: "r2", entry: { a: 2 } },
          ])
          .mockRejectedValueOnce(
            new MissingChunkError("datasets/p1/dataset_1/chunk-00001.jsonl"),
          );
        const storage = makeStorage({ readChunk });

        const result = await recomputeDatasetCounts({
          prisma: prisma as never,
          datasetId: "dataset_1",
          projectId: "p1",
          storage: storage as never,
        });

        // Re-derived from the present prefix: only chunk 0 (2 rows) survives.
        expect(result.chunkCount).toBe(1);
        expect(result.rowCount).toBe(2);
        expect(update.mock.calls[0]![0].data.chunkCount).toBe(1);
        expect(update.mock.calls[0]![0].data.chunkOffsets).toEqual([
          { index: 0, startRow: 0, endRow: 2, byteSize: 56 },
        ]);
      });

      it("still propagates a non-missing-chunk read error", async () => {
        const row = makeDataset({ chunkCount: 2 });
        const { prisma } = makePrisma(row);
        const readChunk = vi
          .fn()
          .mockResolvedValueOnce([{ id: "r1", entry: { a: 1 } }])
          .mockRejectedValueOnce(new Error("S3 connection reset"));
        const storage = makeStorage({ readChunk });

        await expect(
          recomputeDatasetCounts({
            prisma: prisma as never,
            datasetId: "dataset_1",
            projectId: "p1",
            storage: storage as never,
          }),
        ).rejects.toThrow("S3 connection reset");
      });
    });
  });
});
