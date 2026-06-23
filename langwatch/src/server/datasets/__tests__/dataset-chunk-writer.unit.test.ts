import { describe, expect, it } from "vitest";
import { StreamingChunkWriter } from "../dataset-chunk-writer";
import {
  type DatasetChunk,
  toJsonlChunks,
} from "../dataset-chunking";
import type { DatasetStorage } from "../dataset-storage";

/**
 * A fake storage that runs the REAL chunk math (`toJsonlChunks` + the same
 * `fromIndex` rebasing the S3/local impls do) so the writer's cross-flush
 * offset bookkeeping is exercised end-to-end without any I/O. Records every
 * written chunk so a test can assert the resulting key ordering.
 */
const fakeStorage = (
  maxBytes: number,
): { storage: DatasetStorage; writes: DatasetChunk[] } => {
  const writes: DatasetChunk[] = [];
  const storage = {
    async writeChunks({
      records,
      fromIndex = 0,
    }: {
      records: unknown[];
      fromIndex?: number;
    }) {
      const chunks = toJsonlChunks(records, { maxBytes }).map((c) => ({
        ...c,
        index: c.index + fromIndex,
      }));
      writes.push(...chunks);
      return chunks;
    },
  } as unknown as DatasetStorage;
  return { storage, writes };
};

describe("StreamingChunkWriter", () => {
  describe("given a source that triggers more than one push-driven flush", () => {
    it("keeps chunkOffsets globally contiguous across flushes", async () => {
      // The writer flushes once its buffer crosses CHUNK_MAX_BYTES (16 MB).
      // A storage cap of 100 MB makes each flush emit exactly ONE chunk, so a
      // failure shows up cleanly as a per-flush offset reset. `toJsonlChunks`
      // restarts startRow at 0 every writeChunks call; the writer must rebase.
      const { storage, writes } = fakeStorage(100 * 1024 * 1024);
      const writer = new StreamingChunkWriter({
        storage,
        projectId: "proj1",
        datasetId: "ds1",
      });

      // Six ~6 MB rows → the buffer crosses 16 MB at row 2 (flush #1, rows
      // 0-2) and again at row 5 (flush #2, rows 3-5). Two real flushes, each
      // of which would otherwise emit startRow:0.
      const big = "x".repeat(6 * 1024 * 1024);
      for (let n = 0; n < 6; n++) {
        await writer.push({ big, n });
      }
      const meta = await writer.finalize();

      expect(meta.rowCount).toBe(6);
      expect(meta.chunkCount).toBeGreaterThan(1); // proves multi-flush
      // Offsets must form a contiguous 0..rowCount range with no resets.
      expect(meta.chunkOffsets[0]!.startRow).toBe(0);
      for (let i = 1; i < meta.chunkOffsets.length; i++) {
        expect(meta.chunkOffsets[i]!.startRow).toBe(
          meta.chunkOffsets[i - 1]!.endRow,
        );
      }
      expect(
        meta.chunkOffsets[meta.chunkOffsets.length - 1]!.endRow,
      ).toBe(6);
      // Keys stay ordered and contiguous from 0 across flushes.
      expect(writes.map((w) => w.index)).toEqual(writes.map((_, i) => i));
    });
  });

  describe("given a caller-supplied row id", () => {
    it("preserves it instead of minting a fresh one (I-MIG)", async () => {
      const { storage, writes } = fakeStorage(8 * 1024 * 1024);
      const writer = new StreamingChunkWriter({
        storage,
        projectId: "proj1",
        datasetId: "ds1",
      });

      await writer.push({ a: 1 }, { id: "record_keep_me" });
      await writer.finalize();

      expect(writes[0]!.jsonl).toContain('"id":"record_keep_me"');
    });
  });
});
