import { memoryObjectStorage } from "@langwatch/process-stores";
import { describe, expect, it, vi } from "vitest";

import {
  chunkKey,
  toJsonlChunks,
  type ChunkOffset,
  type DatasetChunk,
} from "../../../rules/dataset-chunking.rules.ts";
import type { DatasetChunkRepository } from "../../dataset-chunk.repository.ts";
import { ObjectStorageDatasetChunkRepository } from "../../object-storage/object-storage.dataset-chunk.repository.ts";
import { PrismaDatasetMigrationRepository } from "../prisma.dataset-migration.repository.ts";

type DatasetLayout = { contentLayout: string; useS3: boolean };
type Fingerprint = { count: number; maxUpdatedAt: Date | null };

class FixtureStorage implements DatasetChunkRepository {
  readonly writeChunks = vi.fn(
    async (input: { records: unknown[]; fromIndex?: number }): Promise<DatasetChunk[]> =>
      toJsonlChunks(input.records).map((chunk) => ({
        ...chunk,
        index: chunk.index + (input.fromIndex ?? 0),
      })),
  );
  readonly deleteChunksFrom = vi.fn(async () => {});

  readChunks(): Promise<unknown[]> {
    throw new Error("unused");
  }
  readChunk(): Promise<unknown[]> {
    throw new Error("unused");
  }
  rewriteChunk(): Promise<ChunkOffset> {
    throw new Error("unused");
  }
  readStagedUpload(): Promise<AsyncIterable<Uint8Array>> {
    throw new Error("unused");
  }
  removeStagedUpload(): Promise<void> {
    throw new Error("unused");
  }
}

function fingerprintRow(input: Fingerprint) {
  return {
    _count: { _all: input.count },
    _max: { updatedAt: input.maxUpdatedAt },
  };
}

function fixture(input: {
  current?: DatasetLayout | null;
  candidatePages?: string[][];
  recordPages?: { id: string; entry: unknown }[][];
  storage?: DatasetChunkRepository;
}) {
  const current =
    input.current === undefined ? { contentLayout: "postgres", useS3: false } : input.current;
  const projectFindMany = vi.fn(async () => [{ id: "project_1" }]);
  const datasetFindFirst = vi.fn(async () => current);
  const lockedDatasetFindFirst = vi.fn(async () => current);
  const datasetFindMany = vi.fn();
  for (const page of input.candidatePages ?? [[]]) {
    datasetFindMany.mockResolvedValueOnce(page.map((id) => ({ id })));
  }

  const recordFindMany = vi.fn();
  for (const page of input.recordPages ?? [[]]) {
    recordFindMany.mockResolvedValueOnce(page);
  }
  const recordAggregate = vi.fn(async () => fingerprintRow({ count: 0, maxUpdatedAt: null }));
  const update = vi.fn(async () => {});
  const executeRaw = vi.fn(async () => 1);
  const transaction = {
    $executeRaw: executeRaw,
    dataset: { findFirst: lockedDatasetFindFirst, update },
    datasetRecord: { aggregate: recordAggregate },
  };
  async function runTransaction<TResult>(
    operation: (database: typeof transaction) => Promise<TResult>,
  ): Promise<TResult> {
    return operation(transaction);
  }

  const database = {
    project: { findMany: projectFindMany },
    dataset: {
      findFirst: datasetFindFirst,
      findMany: datasetFindMany,
      update,
    },
    datasetRecord: {
      findMany: recordFindMany,
      aggregate: recordAggregate,
    },
    $transaction: runTransaction,
  };
  const storage = new FixtureStorage();
  // Prisma's delegates derive their return types from the arguments each call
  // was made with, so no hand-written stand-in can be declared to satisfy one.
  // The fake records what it was asked, which is what every claim below reads.
  const migration = PrismaDatasetMigrationRepository.create({
    database: database as never,
    storage: input.storage ?? storage,
  });

  return {
    database,
    datasetFindFirst,
    datasetFindMany,
    executeRaw,
    lockedDatasetFindFirst,
    migration,
    recordAggregate,
    recordFindMany,
    storage,
    update,
  };
}

describe("given a deployment whose dataset destination is its object storage", () => {
  describe("when the backfill migrates a postgres-layout dataset", () => {
    /** @scenario "The dataset-content backfill task migrates a postgres-layout dataset onto azure" */
    it("writes the chunk objects through the object storage at the released chunk key", async () => {
      const objectStorage = memoryObjectStorage();
      const subject = fixture({
        recordPages: [[{ id: "record_1", entry: { value: 1 } }], []],
        storage: ObjectStorageDatasetChunkRepository.create({ objectStorage }),
      });
      subject.recordAggregate.mockResolvedValue(
        fingerprintRow({ count: 1, maxUpdatedAt: new Date("2026-01-01T00:00:00.000Z") }),
      );

      await expect(
        subject.migration.migrateDataset({ datasetId: "dataset_1", projectId: "project_1" }),
      ).resolves.toBe("migrated");

      const stored = await objectStorage.read({
        projectId: "project_1",
        key: chunkKey("project_1", "dataset_1", 0),
      });
      const text = await new Response(ReadableStream.from(stored)).text();
      expect(text).toContain('"record_1"');
    });
  });
});

describe("PrismaDatasetMigrationRepository", () => {
  /**
   * @scenario "An existing dataset stays usable after the storage migration"
   * @scenario "A very large dataset migrates without loading every row at once"
   */
  it("streams ordered pages, preserves ids and atomically flips the dataset", async () => {
    const subject = fixture({
      recordPages: [
        [
          { id: "record_1", entry: { value: 1 } },
          { id: "record_2", entry: { value: 2 } },
        ],
        [{ id: "record_3", entry: { value: 3 } }],
        [],
      ],
    });
    subject.recordAggregate.mockResolvedValue(
      fingerprintRow({
        count: 3,
        maxUpdatedAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
    );

    await expect(
      subject.migration.migrateDataset({
        datasetId: "dataset_1",
        projectId: "project_1",
      }),
    ).resolves.toBe("migrated");

    expect(subject.recordFindMany).toHaveBeenNthCalledWith(2, {
      where: { datasetId: "dataset_1", projectId: "project_1" },
      select: { id: true, entry: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 1000,
      cursor: { id: "record_2" },
      skip: 1,
    });
    expect(subject.storage.writeChunks.mock.calls[0]?.[0].records).toEqual([
      { id: "record_1", entry: { value: 1 } },
      { id: "record_2", entry: { value: 2 } },
      { id: "record_3", entry: { value: 3 } },
    ]);
    expect(subject.storage.writeChunks.mock.calls[0]?.[0]).toMatchObject({
      projectId: "project_1",
    });
    expect(subject.executeRaw).toHaveBeenCalledOnce();
    expect(subject.storage.deleteChunksFrom).toHaveBeenCalledWith({
      datasetId: "dataset_1",
      projectId: "project_1",
      fromIndex: 1,
    });
    expect(subject.update).toHaveBeenCalledWith({
      where: { id: "dataset_1", projectId: "project_1" },
      data: expect.objectContaining({
        rowCount: 3,
        chunkCount: 1,
        contentLayout: "s3_jsonl",
      }),
    });
  });

  it.each([
    {
      label: "record count",
      baseline: { count: 1, maxUpdatedAt: new Date(0) },
      recheck: { count: 2, maxUpdatedAt: new Date(0) },
    },
    {
      label: "latest record update",
      baseline: { count: 1, maxUpdatedAt: new Date(0) },
      recheck: { count: 1, maxUpdatedAt: new Date(1) },
    },
  ])("leaves Postgres live when the $label changes", async ({ baseline, recheck }) => {
    const subject = fixture({
      recordPages: [[{ id: "record_1", entry: { value: 1 } }], []],
    });
    subject.recordAggregate
      .mockResolvedValueOnce(fingerprintRow(baseline))
      .mockResolvedValueOnce(fingerprintRow(recheck));

    await expect(
      subject.migration.migrateDataset({
        datasetId: "dataset_1",
        projectId: "project_1",
      }),
    ).resolves.toBe("skipped-concurrent-write");
    expect(subject.update).not.toHaveBeenCalled();
  });

  /**
   * @scenario "The storage migration is safe to run more than once"
   * @scenario "A legacy single-blob dataset is left readable, not emptied"
   */
  it("skips migrated and legacy single-blob datasets before storage access", async () => {
    for (const current of [
      { contentLayout: "s3_jsonl", useS3: false },
      { contentLayout: "postgres", useS3: true },
    ]) {
      const subject = fixture({ current });
      await expect(
        subject.migration.migrateDataset({
          datasetId: "dataset_1",
          projectId: "project_1",
        }),
      ).resolves.toBe("already-migrated");
      expect(subject.storage.writeChunks).not.toHaveBeenCalled();
    }
  });

  it("reports a dry run without reading, locking or resolving storage", async () => {
    const subject = fixture({});

    await expect(
      subject.migration.migrateDataset(
        { datasetId: "dataset_1", projectId: "project_1" },
        { dryRun: true },
      ),
    ).resolves.toBe("would-migrate");
    expect(subject.datasetFindFirst).not.toHaveBeenCalled();
    expect(subject.executeRaw).not.toHaveBeenCalled();
    expect(subject.storage.writeChunks).not.toHaveBeenCalled();
  });

  it("tallies every durable outcome and continues after a failure", async () => {
    const subject = fixture({
      candidatePages: [["dataset_1", "dataset_2", "dataset_3", "dataset_4"], []],
      recordPages: [[], []],
    });
    subject.datasetFindFirst
      .mockReset()
      .mockRejectedValueOnce(new Error("first dataset failed"))
      .mockResolvedValueOnce({ contentLayout: "s3_jsonl", useS3: false })
      .mockResolvedValueOnce({ contentLayout: "postgres", useS3: false })
      .mockResolvedValueOnce({ contentLayout: "postgres", useS3: false });
    subject.recordAggregate
      .mockResolvedValueOnce(fingerprintRow({ count: 0, maxUpdatedAt: null }))
      .mockResolvedValueOnce(fingerprintRow({ count: 1, maxUpdatedAt: null }))
      .mockResolvedValueOnce(fingerprintRow({ count: 0, maxUpdatedAt: null }))
      .mockResolvedValueOnce(fingerprintRow({ count: 0, maxUpdatedAt: null }));

    await expect(subject.migration.run()).resolves.toEqual({
      status: "completed",
      summary: {
        migrated: 1,
        wouldMigrate: 0,
        alreadyMigrated: 1,
        skippedConcurrentWrite: 1,
        failed: 1,
      },
    });
  });

  it("paginates candidates and tallies dry-run outcomes", async () => {
    const subject = fixture({
      candidatePages: [["dataset_1"], ["dataset_2"], []],
    });

    await expect(subject.migration.run({ dryRun: true })).resolves.toEqual({
      status: "completed",
      summary: {
        migrated: 0,
        wouldMigrate: 2,
        alreadyMigrated: 0,
        skippedConcurrentWrite: 0,
        failed: 0,
      },
    });
    expect(subject.datasetFindMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({ id: { gt: "dataset_1" } }),
      }),
    );
  });

  it("reports a pending schema without leaking a database error to the task", async () => {
    const subject = fixture({});
    subject.database.project.findMany = vi.fn(async () => {
      throw Object.assign(new Error("P2022"), { code: "P2022" });
    });

    await expect(subject.migration.run()).resolves.toEqual({
      status: "schema-pending",
    });
  });
});
