import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { PostgresDatasetMigrationAdapter } from "../postgres.dataset-migration.adapter";
import type { DatasetStorage, PresignedUpload } from "../../ports/dataset-storage.port";
import { DatasetStorageResolver } from "../../ports/dataset-storage.port";
import {
  toJsonlChunks,
  type ChunkOffset,
  type DatasetChunk,
} from "../../services/dataset-chunking";

type DatasetLayout = { contentLayout: string; useS3: boolean };
type Fingerprint = { count: number; maxUpdatedAt: Date | null };

class FixtureStorage implements DatasetStorage {
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
  createPresignedUpload(): Promise<PresignedUpload> {
    throw new Error("unused");
  }
  headStagedObjectSize(): Promise<number> {
    throw new Error("unused");
  }
  streamStaged(): Promise<Readable> {
    throw new Error("unused");
  }
  deleteStaged(): Promise<void> {
    throw new Error("unused");
  }
}

class FixtureStorageResolver extends DatasetStorageResolver {
  readonly forProject = vi.fn(async () => this.storage);

  constructor(private readonly storage: DatasetStorage) {
    super();
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
  recordPages?: Array<Array<{ id: string; entry: unknown }>>;
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
  const storageResolver = new FixtureStorageResolver(storage);
  // Prisma's delegates derive their return types from the arguments each call
  // was made with, so no hand-written stand-in can be declared to satisfy one.
  // The fake records what it was asked, which is what every claim below reads.
  const migration = PostgresDatasetMigrationAdapter.create({
    database: database as never,
    storage: storageResolver,
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
    storageResolver,
    update,
  };
}

describe("PostgresDatasetMigrationAdapter", () => {
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
    expect(subject.storageResolver.forProject).toHaveBeenCalledWith("project_1");
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
      expect(subject.storageResolver.forProject).not.toHaveBeenCalled();
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
    expect(subject.storageResolver.forProject).not.toHaveBeenCalled();
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
