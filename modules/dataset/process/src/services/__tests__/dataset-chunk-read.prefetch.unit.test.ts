import { memoryObjectStorage } from "@langwatch/process-stores";
import { describe, expect, it } from "vitest";

import type { DatasetChunkRepository } from "../../repositories/dataset-chunk.repository.ts";
import { ObjectStorageDatasetChunkRepository } from "../../repositories/object-storage/object-storage.dataset-chunk.repository.ts";
import { CHUNK_MAX_BYTES, type ChunkOffset } from "../../rules/dataset-chunking.rules.ts";
import { CHUNK_READS_IN_FLIGHT, DatasetChunkReadService } from "../dataset-chunk-read.service.ts";

const projectId = "project_prefetch";
const datasetId = "dataset_prefetch";

/** Chunks of one row each, over memory storage whose reads are counted while in flight. */
async function slowChunks({ count, failAt }: { count: number; failAt?: number }) {
  const chunks = ObjectStorageDatasetChunkRepository.create({
    objectStorage: memoryObjectStorage(),
  });
  for (let index = 0; index < count; index++) {
    await chunks.writeChunks({
      projectId,
      datasetId,
      records: [{ id: `row_${index}`, entry: { n: index } }],
      fromIndex: index,
    });
  }
  const seen = { inFlight: 0, most: 0, started: [] as number[] };
  const storage: DatasetChunkRepository = Object.assign(Object.create(chunks), {
    readChunk: async (input: { projectId: string; datasetId: string; index: number }) => {
      seen.inFlight += 1;
      seen.most = Math.max(seen.most, seen.inFlight);
      seen.started.push(input.index);
      try {
        await new Promise((resolve) => setTimeout(resolve, 2));
        if (input.index === failAt) throw new Error(`chunk ${input.index} failed`);
        return await chunks.readChunk(input);
      } finally {
        seen.inFlight -= 1;
      }
    },
  });
  return { storage, seen };
}

const offsetsOf = ({ count, byteSize }: { count: number; byteSize: number }): ChunkOffset[] =>
  Array.from({ length: count }, (_, index) => ({
    index,
    startRow: index,
    endRow: index + 1,
    byteSize,
  }));

const reads = DatasetChunkReadService.create();

describe("DatasetChunkReadService.chunksInOrder", () => {
  describe("when a dataset holds many small chunks", () => {
    /** @scenario "A dataset of many small chunks reads several chunks at once, in row order" */
    it("fetches several at once, up to the cap, and yields them in index order", async () => {
      const { storage, seen } = await slowChunks({ count: 40 });
      const rows: unknown[] = [];
      for await (const chunk of reads.chunksInOrder({
        storage,
        projectId,
        datasetId,
        chunkCount: 40,
        offsets: offsetsOf({ count: 40, byteSize: 40 }),
      })) {
        rows.push(...chunk);
      }

      expect(seen.most).toBeGreaterThan(1);
      expect(seen.most).toBeLessThanOrEqual(CHUNK_READS_IN_FLIGHT);
      expect(rows.map((row) => (row as { id: string }).id)).toEqual(
        Array.from({ length: 40 }, (_, index) => `row_${index}`),
      );
    });

    it("reads only the chunks it is given, in their order", async () => {
      const { storage } = await slowChunks({ count: 10 });
      const ids: string[] = [];
      for await (const chunk of reads.chunksInOrder({
        storage,
        projectId,
        datasetId,
        indices: [7, 2, 5],
        offsets: [],
      })) {
        ids.push(...chunk.map((row) => (row as { id: string }).id));
      }
      expect(ids).toEqual(["row_7", "row_2", "row_5"]);
    });
  });

  describe("when the chunks are at the size limit", () => {
    /** @scenario "A read of full-size chunks holds at most one chunk ahead of the reader" */
    it("keeps at most one chunk in flight ahead of the reader", async () => {
      const { storage, seen } = await slowChunks({ count: 6 });
      for await (const _chunk of reads.chunksInOrder({
        storage,
        projectId,
        datasetId,
        chunkCount: 6,
        offsets: offsetsOf({ count: 6, byteSize: CHUNK_MAX_BYTES }),
      })) {
        expect(seen.inFlight).toBeLessThanOrEqual(1);
      }
      expect(seen.most).toBe(1);
    });

    it("treats a chunk the offset index does not size as full-size", async () => {
      const { storage, seen } = await slowChunks({ count: 6 });
      for await (const _chunk of reads.chunksInOrder({
        storage,
        projectId,
        datasetId,
        chunkCount: 6,
        offsets: [],
      })) {
        // drain
      }
      expect(seen.most).toBe(1);
    });
  });

  describe("when a later chunk fails to read", () => {
    /** @scenario "A read that stops early or meets a failed chunk leaves no unhandled failure" */
    // An unseen rejection would fail this run: vitest reports unhandled errors as failures.
    it("ends quietly when the reader stops first, and fails with that chunk's error when reached", async () => {
      const early = await slowChunks({ count: 12, failAt: 5 });
      for await (const _chunk of reads.chunksInOrder({
        storage: early.storage,
        projectId,
        datasetId,
        chunkCount: 12,
        offsets: offsetsOf({ count: 12, byteSize: 40 }),
      })) {
        break;
      }

      const reached = await slowChunks({ count: 12, failAt: 5 });
      const drain = async () => {
        for await (const _chunk of reads.chunksInOrder({
          storage: reached.storage,
          projectId,
          datasetId,
          chunkCount: 12,
          offsets: offsetsOf({ count: 12, byteSize: 40 }),
        })) {
          // drain
        }
      };
      await expect(drain()).rejects.toThrow("chunk 5 failed");
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(early.seen.inFlight).toBe(0);
    });
  });
});
