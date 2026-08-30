/**
 * @vitest-environment node
 *
 * The s3_jsonl chunk mutations, which had no test of any kind while carrying
 * the most dangerous invariant in the feature: the Postgres counters
 * (`rowCount`/`sizeBytes`/`chunkCount`/`chunkOffsets`) must agree with the S3
 * chunk set, and they only can because every mutation runs inside one
 * per-dataset advisory lock (ADR-032 Decision 9, I-COUNT).
 *
 * What each case is really asserting is that the counter write lands on the
 * TRANSACTIONAL repository. A write that reached the root repository would
 * commit outside the lock's transaction, so a rolled-back chunk write would
 * leave the counters claiming rows that are not there.
 */
import { describe, expect, it } from "vitest";
import type { DatasetStorage } from "../../ports/dataset-storage.port";
import type { DatasetContentRepository } from "../../repositories/prisma/dataset-content.repository";
import { DatasetChunkService, type DatasetMutationRecord } from "../dataset-chunk.service";

type Update = { id: string; data: Record<string, unknown>; transactional: boolean };

/**
 * A repository whose `withDatasetLock` hands the callback a DIFFERENT instance,
 * exactly as the Prisma one hands back a transaction-bound repository. Every
 * write records which of the two it arrived on, so a mutation that wrote
 * outside the lock is visible rather than merely untested.
 */
function fakeRepository(record: DatasetMutationRecord) {
  const updates: Update[] = [];
  const locks: string[] = [];
  let current = record;

  const make = (transactional: boolean): DatasetContentRepository =>
    ({
      findOneOrThrow: async () => current,
      update: async (input: { id: string; data: Record<string, unknown> }) => {
        updates.push({ id: input.id, data: input.data, transactional });
        current = { ...current, ...(input.data as Partial<DatasetMutationRecord>) };
        return current;
      },
      withDatasetLock: async <T>(
        datasetId: string,
        mutate: (tx: DatasetContentRepository) => Promise<T>,
      ): Promise<T> => {
        locks.push(datasetId);
        return await mutate(make(true));
      },
    }) as unknown as DatasetContentRepository;

  const datasets = make(false);
  return { chunks: DatasetChunkService.create({ datasets }), updates, locks };
}

/** Chunks as a plain array of arrays, which is what the real storage stores. */
function fakeStorage(chunks: unknown[][] = []) {
  const storage = {
    writeChunks: async ({ records, fromIndex = 0 }: { records: unknown[]; fromIndex?: number }) => {
      chunks[fromIndex] = records;
      return [{ index: fromIndex, rowCount: records.length, byteSize: records.length * 10 }];
    },
    readChunk: async ({ index }: { index: number }) => chunks[index] ?? [],
    rewriteChunk: async ({ index, records }: { index: number; records: unknown[] }) => {
      chunks[index] = records;
      return { index, rowCount: records.length, byteSize: records.length * 10 };
    },
    deleteChunksFrom: async ({ fromIndex }: { fromIndex: number }) => {
      chunks.length = Math.min(chunks.length, fromIndex);
    },
  } as unknown as DatasetStorage;
  return { storage, chunks };
}

function readyDataset(overrides: Partial<DatasetMutationRecord> = {}): DatasetMutationRecord {
  return {
    id: "dataset-1",
    status: "ready",
    statusError: null,
    chunkCount: 0,
    chunkOffsets: [],
    rowCount: 0,
    sizeBytes: 0n,
    columnTypes: {},
    ...overrides,
  };
}

const projectId = "project-1";
const oneChunk = {
  chunkCount: 1,
  rowCount: 2,
  sizeBytes: 20n,
  chunkOffsets: [{ index: 0, start: 0, rowCount: 2, byteSize: 20 }],
};

describe("DatasetChunkService", () => {
  describe("when appending records to a ready dataset", () => {
    it("takes the dataset's advisory lock", async () => {
      const { chunks, locks } = fakeRepository(readyDataset());
      const { storage } = fakeStorage();

      await chunks.append({ dataset: readyDataset(), projectId, entries: [{ a: 1 }], storage });

      expect(locks).toEqual(["dataset-1"]);
    });

    it("writes the counters on the transactional repository, never the root", async () => {
      const { chunks, updates } = fakeRepository(readyDataset());
      const { storage } = fakeStorage();

      await chunks.append({
        dataset: readyDataset(),
        projectId,
        entries: [{ a: 1 }, { a: 2 }],
        storage,
      });

      expect(updates).not.toHaveLength(0);
      expect(updates.every((update) => update.transactional)).toBe(true);
    });

    it("counts the rows it appended", async () => {
      const { chunks } = fakeRepository(readyDataset());
      const { storage, chunks: stored } = fakeStorage();

      const result = await chunks.append({
        dataset: readyDataset(),
        projectId,
        entries: [{ a: 1 }, { a: 2 }, { a: 3 }],
        storage,
      });

      expect(result.appended).toBe(3);
      expect(stored[0]).toHaveLength(3);
    });
  });

  describe("when the dataset is still preparing", () => {
    it("refuses the append before writing anything", async () => {
      const preparing = readyDataset({ status: "processing" });
      const { chunks, updates } = fakeRepository(preparing);
      const { storage, chunks: stored } = fakeStorage();

      await expect(
        chunks.append({ dataset: preparing, projectId, entries: [{ a: 1 }], storage }),
      ).rejects.toMatchObject({ code: "dataset_not_ready" });

      expect(updates).toEqual([]);
      expect(stored).toEqual([]);
    });
  });

  describe("when editing one record", () => {
    it("rewrites only the chunk holding it, under the lock", async () => {
      const dataset = readyDataset(oneChunk);
      const { chunks, updates, locks } = fakeRepository(dataset);
      const { storage, chunks: stored } = fakeStorage([
        [
          { id: "r1", entry: { a: 1 } },
          { id: "r2", entry: { a: 2 } },
        ],
      ]);

      await chunks.editRecord({
        dataset,
        projectId,
        recordId: "r2",
        entry: { a: 99 },
        storage,
      });

      expect(locks).toEqual(["dataset-1"]);
      expect(stored[0]).toHaveLength(2);
      expect(updates.every((update) => update.transactional)).toBe(true);
    });
  });

  describe("when deleting records", () => {
    it("reports how many it removed and commits the count transactionally", async () => {
      const dataset = readyDataset(oneChunk);
      const { chunks, updates } = fakeRepository(dataset);
      const { storage } = fakeStorage([
        [
          { id: "r1", entry: { a: 1 } },
          { id: "r2", entry: { a: 2 } },
        ],
      ]);

      const result = await chunks.deleteRecords({
        dataset,
        projectId,
        recordIds: ["r1"],
        storage,
      });

      expect(result.deleted).toBe(1);
      expect(updates.every((update) => update.transactional)).toBe(true);
    });
  });

  describe("when recomputing the counters", () => {
    it("derives them from the chunks and commits inside the lock", async () => {
      const dataset = readyDataset({ chunkCount: 2, rowCount: 99, sizeBytes: 999n });
      const { chunks, updates, locks } = fakeRepository(dataset);
      const { storage } = fakeStorage([
        [
          { id: "r1", entry: {} },
          { id: "r2", entry: {} },
        ],
        [{ id: "r3", entry: {} }],
      ]);

      const counts = await chunks.recomputeCounts({ datasetId: "dataset-1", projectId, storage });

      expect(counts.rowCount).toBe(3);
      expect(locks).toEqual(["dataset-1"]);
      expect(updates.every((update) => update.transactional)).toBe(true);
    });
  });
});
