/**
 * @vitest-environment node
 * The s3_jsonl chunk mutations: each case asserts the counter write lands on
 * the TRANSACTIONAL repository (ADR-032 Decision 9, I-COUNT), not the root one.
 */
import { describe, expect, it } from "vitest";
import type { DatasetColumns } from "@langwatch/dataset-contract";
import type { DatasetStorage } from "../../ports/dataset-storage.port";
import type { DatasetContentRepository } from "../../repositories/dataset-content.repository";
import { DatasetChunkService, type DatasetMutationRecord } from "../dataset-chunk.service";

type Update = { id: string; content: Record<string, unknown>; transactional: boolean };

/**
 * A repository whose `withDatasetLock` hands the callback a DIFFERENT instance,
 * as Prisma does. Every write records which of the two it arrived on.
 */
function fakeRepository(record: DatasetMutationRecord) {
  const updates: Update[] = [];
  const locks: string[] = [];
  let current = record;

  const make = (transactional: boolean): DatasetContentRepository =>
    ({
      findOneOrThrow: async () => current,
      updateContent: async (input: { id: string; content: Record<string, unknown> }) => {
        updates.push({ id: input.id, content: input.content, transactional });
        current = { ...current, ...(input.content as Partial<DatasetMutationRecord>) };
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

    /** @scenario "Appending rows adds new data and preserves existing rows" */
    it("adds the new rows without disturbing the existing chunk", async () => {
      const dataset = readyDataset(oneChunk);
      const { chunks } = fakeRepository(dataset);
      const { storage, chunks: stored } = fakeStorage([
        [
          { id: "r1", entry: { a: 1 } },
          { id: "r2", entry: { a: 2 } },
        ],
      ]);

      const result = await chunks.append({
        dataset,
        projectId,
        entries: [{ a: 3 }, { a: 4 }, { a: 5 }],
        storage,
      });

      expect(result.appended).toBe(3);
      expect(stored[0]).toEqual([
        { id: "r1", entry: { a: 1 } },
        { id: "r2", entry: { a: 2 } },
      ]);
      expect(stored[1]).toHaveLength(3);
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

  describe("when editing one row and deleting another", () => {
    /** @scenario "Editing or deleting a row updates only that row" */
    it("saves both changes and leaves the other rows unaffected", async () => {
      const dataset = readyDataset({
        chunkCount: 1,
        rowCount: 3,
        sizeBytes: 30n,
        chunkOffsets: [{ index: 0, start: 0, rowCount: 3, byteSize: 30 }],
      });
      const { chunks } = fakeRepository(dataset);
      const { storage, chunks: stored } = fakeStorage([
        [
          { id: "r1", entry: { a: 1 } },
          { id: "r2", entry: { a: 2 } },
          { id: "r3", entry: { a: 3 } },
        ],
      ]);

      await chunks.editRecord({ dataset, projectId, recordId: "r2", entry: { a: 99 }, storage });
      const deleted = await chunks.deleteRecords({
        dataset,
        projectId,
        recordIds: ["r3"],
        storage,
      });

      expect(deleted.deleted).toBe(1);
      expect(stored[0]).toEqual([
        { id: "r1", entry: { a: 1 } },
        { id: "r2", entry: { a: 99 } },
      ]);
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

  describe("when changing a column's type", () => {
    const scoreAsText: DatasetColumns = [{ name: "score", type: "string" }];
    const scoreAsNumber: DatasetColumns = [{ name: "score", type: "number" }];

    /** @scenario "Changing a column's type re-converts the stored values" */
    it("converts the stored values to the new type and leaves other rows unchanged", async () => {
      const dataset = readyDataset({ ...oneChunk, columnTypes: scoreAsText });
      const { chunks } = fakeRepository(dataset);
      const { storage, chunks: stored } = fakeStorage([
        [
          { id: "r1", entry: { score: "10" } },
          { id: "r2", entry: { score: "20" } },
        ],
      ]);

      const result = await chunks.migrateColumns({
        dataset,
        projectId,
        oldColumnTypes: scoreAsText,
        newColumnTypes: scoreAsNumber,
        name: "Scores",
        slug: "scores",
        storage,
      });

      expect(result.columnTypes).toEqual(scoreAsNumber);
      expect(stored[0]).toEqual([
        { id: "r1", entry: { score: 10 } },
        { id: "r2", entry: { score: 20 } },
      ]);
    });

    /** @scenario "Retyping a text column to an image URL keeps the value" */
    it("keeps a data URL untouched when retyping the column to image", async () => {
      const dataUrl = "data:image/png;base64,aGVsbG8=";
      const asText: DatasetColumns = [{ name: "photo", type: "string" }];
      const asImage: DatasetColumns = [{ name: "photo", type: "image" }];
      const dataset = readyDataset({ ...oneChunk, columnTypes: asText });
      const { chunks } = fakeRepository(dataset);
      const { storage, chunks: stored } = fakeStorage([[{ id: "r1", entry: { photo: dataUrl } }]]);

      const result = await chunks.migrateColumns({
        dataset,
        projectId,
        oldColumnTypes: asText,
        newColumnTypes: asImage,
        name: "Photos",
        slug: "photos",
        storage,
      });

      expect(result.columnTypes).toEqual(asImage);
      expect(stored[0]).toEqual([{ id: "r1", entry: { photo: dataUrl } }]);
    });
  });
});
