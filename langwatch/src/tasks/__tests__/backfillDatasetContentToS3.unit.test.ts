import { type Dataset, type DatasetRecord, Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `execute()` touches the real prisma client + storage accessors only AFTER the
// SKIP guard. The SKIP test asserts the guard returns first, so the db module is
// stubbed to a no-op prisma to keep the unit test from opening a connection.
// `vi.mock` is hoisted above these imports by vitest.
vi.mock("../../server/db", () => ({
  prisma: {
    project: { findMany: vi.fn() },
    dataset: { findMany: vi.fn() },
  },
}));

import { prisma as mockedPrisma } from "../../server/db";
import execute, {
  type BackfillDeps,
  migrateAllPostgresDatasets,
  migrateDatasetToS3,
} from "../backfillDatasetContentToS3";

/**
 * Unit tests for the PG→S3 backfill migration (ADR-032 rung 5). Boundary mocks:
 * the `DatasetStorage` chunk writer is a fake passed via `getStorage`, the
 * record repository's `findDatasetRecords` is stubbed, the storage destination
 * resolver is stubbed, and Prisma is stubbed at the `$transaction` /
 * advisory-lock (`$executeRaw`) seam. The chunk math + flip logic under test stay
 * real.
 */

const makeDataset = (overrides: Partial<Dataset> = {}): Dataset =>
  ({
    id: "dataset_1",
    projectId: "p1",
    name: "DS",
    slug: "ds",
    contentLayout: "postgres",
    status: "ready",
    statusError: null,
    rowCount: null,
    sizeBytes: null,
    chunkCount: null,
    chunkOffsets: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
    ...overrides,
  }) as unknown as Dataset;

const makeRecord = (id: string, entry: unknown): DatasetRecord =>
  ({
    id,
    entry,
    datasetId: "dataset_1",
    projectId: "p1",
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as unknown as DatasetRecord;

/**
 * A Prisma stub whose `$transaction(fn)` runs `fn` with a tx whose
 * `dataset.findFirst` returns `row` and whose `dataset.update` is a spy.
 * `$executeRaw` is the advisory-lock seam — spied so a test can assert the lock
 * was taken (mirrors the 6b mutations test).
 */
const makePrisma = (row: Dataset | null) => {
  const update = vi.fn().mockResolvedValue(undefined);
  const findFirst = vi.fn().mockResolvedValue(row);
  const executeRaw = vi.fn().mockResolvedValue([]);
  const tx = {
    $executeRaw: executeRaw,
    dataset: { findFirst, update },
  };
  const prisma = {
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  return { prisma, tx, update, findFirst, executeRaw };
};

const makeStorage = (
  writeChunks: ReturnType<typeof vi.fn>,
  deleteChunksFrom: ReturnType<typeof vi.fn> = vi
    .fn()
    .mockResolvedValue(undefined),
) => ({
  writeChunks,
  deleteChunksFrom,
});

const makeDeps = (overrides: Partial<BackfillDeps> = {}): BackfillDeps =>
  ({
    prisma: {} as never,
    recordRepository: { findDatasetRecords: vi.fn() } as never,
    resolveStorage: vi.fn().mockResolvedValue({ kind: "s3", bucket: "b" }),
    getStorage: vi.fn(),
    ...overrides,
  }) as BackfillDeps;

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  delete process.env.SKIP_DATASET_S3_MIGRATE;
});

describe("backfillDatasetContentToS3", () => {
  describe("migrateDatasetToS3()", () => {
    describe("when a postgres dataset has S3 storage configured", () => {
      /** @scenario An existing dataset stays usable after the storage migration */
      it("writes its rows to S3 as chunks (ids preserved) and flips the dataset to s3_jsonl with correct counts", async () => {
        const row = makeDataset({ contentLayout: "postgres" });
        const { prisma, update, executeRaw } = makePrisma(row);
        const findDatasetRecords = vi
          .fn()
          .mockResolvedValue([
            makeRecord("rec_a", { q: "1" }),
            makeRecord("rec_b", { q: "2" }),
          ]);
        const writeChunks = vi.fn().mockResolvedValue([
          {
            index: 0,
            rowCount: 2,
            byteSize: 42,
            startRow: 0,
            endRow: 2,
          },
        ]);
        const deps = makeDeps({
          prisma: prisma as never,
          recordRepository: { findDatasetRecords } as never,
          getStorage: vi.fn().mockResolvedValue(makeStorage(writeChunks)),
        });

        const outcome = await migrateDatasetToS3(
          { dataset: row, projectId: "p1" },
          deps,
        );

        expect(outcome).toBe("migrated");
        // Advisory lock taken inside the transaction.
        expect(executeRaw).toHaveBeenCalledOnce();
        // Rows written from index 0, wrapped { id, entry } with ids PRESERVED.
        const writeArgs = writeChunks.mock.calls[0]![0];
        expect(writeArgs.fromIndex).toBe(0);
        expect(writeArgs.records).toEqual([
          { id: "rec_a", entry: { q: "1" } },
          { id: "rec_b", entry: { q: "2" } },
        ]);
        // Dataset flipped to s3_jsonl with the chunk-derived counters.
        expect(update.mock.calls[0]![0].data).toEqual({
          rowCount: 2,
          sizeBytes: 42n,
          chunkCount: 1,
          chunkOffsets: [{ index: 0, startRow: 0, endRow: 2, byteSize: 42 }],
          contentLayout: "s3_jsonl",
        });
      });

      /**
       * @scenario The storage migration is safe to run more than once
       *
       * Orphan-chunk cleanup (I-IDEM): after writing, the migration drops any
       * chunk objects from `written.length` upward so a re-drive that produced
       * fewer chunks than a crashed prior run can't leave dangling `chunk-{n}`
       * objects (no duplicated or lost rows on re-run).
       */
      it("deletes orphan chunks from the written count upward (defensive, I-IDEM)", async () => {
        const row = makeDataset({ contentLayout: "postgres" });
        const { prisma } = makePrisma(row);
        const findDatasetRecords = vi
          .fn()
          .mockResolvedValue([makeRecord("rec_a", { q: "1" })]);
        const writeChunks = vi.fn().mockResolvedValue([
          { index: 0, rowCount: 1, byteSize: 20, startRow: 0, endRow: 1 },
          { index: 1, rowCount: 1, byteSize: 20, startRow: 1, endRow: 2 },
        ]);
        const deleteChunksFrom = vi.fn().mockResolvedValue(undefined);
        const deps = makeDeps({
          prisma: prisma as never,
          recordRepository: { findDatasetRecords } as never,
          getStorage: vi
            .fn()
            .mockResolvedValue(makeStorage(writeChunks, deleteChunksFrom)),
        });

        await migrateDatasetToS3({ dataset: row, projectId: "p1" }, deps);

        // Wrote 2 chunks → delete everything from index 2 upward.
        expect(deleteChunksFrom).toHaveBeenCalledWith({
          projectId: "p1",
          datasetId: "dataset_1",
          fromIndex: 2,
        });
      });

      /**
       * @scenario An existing dataset stays usable after the storage migration
       *
       * "The same rows as before" includes row ORDER. The deterministic
       * `createdAt asc, id asc` order is enforced at the `findDatasetRecords`
       * repository read (asserted in dataset-record.repository.unit.test.ts);
       * this guards the migration SIDE of the contract: it must write rows in
       * exactly the order the repo returns them — never re-sorting or
       * reshuffling — so chunk/row order matches the PG read paths and is stable
       * across crash-resume re-runs.
       */
      it("writes rows to S3 in the exact order findDatasetRecords returns them (no reshuffle)", async () => {
        const row = makeDataset({ contentLayout: "postgres" });
        const { prisma } = makePrisma(row);
        // Repo returns rows already in canonical createdAt/id order.
        const findDatasetRecords = vi
          .fn()
          .mockResolvedValue([
            makeRecord("rec_a", { n: 1 }),
            makeRecord("rec_b", { n: 2 }),
            makeRecord("rec_c", { n: 3 }),
          ]);
        const writeChunks = vi
          .fn()
          .mockResolvedValue([
            { index: 0, rowCount: 3, byteSize: 60, startRow: 0, endRow: 3 },
          ]);
        const deps = makeDeps({
          prisma: prisma as never,
          recordRepository: { findDatasetRecords } as never,
          getStorage: vi.fn().mockResolvedValue(makeStorage(writeChunks)),
        });

        await migrateDatasetToS3({ dataset: row, projectId: "p1" }, deps);

        // writeChunks must receive the rows in the SAME order the repo yielded.
        const writeArgs = writeChunks.mock.calls[0]![0];
        expect(writeArgs.records).toEqual([
          { id: "rec_a", entry: { n: 1 } },
          { id: "rec_b", entry: { n: 2 } },
          { id: "rec_c", entry: { n: 3 } },
        ]);
      });

      it("does not delete the PG DatasetRecord rows (non-destructive, I-MIG)", async () => {
        const row = makeDataset({ contentLayout: "postgres" });
        const { prisma } = makePrisma(row);
        const deleteMany = vi.fn();
        const findDatasetRecords = vi
          .fn()
          .mockResolvedValue([makeRecord("rec_a", { q: "1" })]);
        const writeChunks = vi
          .fn()
          .mockResolvedValue([
            { index: 0, rowCount: 1, byteSize: 20, startRow: 0, endRow: 1 },
          ]);
        const deps = makeDeps({
          prisma: prisma as never,
          recordRepository: { findDatasetRecords, deleteMany } as never,
          getStorage: vi.fn().mockResolvedValue(makeStorage(writeChunks)),
        });

        await migrateDatasetToS3({ dataset: row, projectId: "p1" }, deps);

        expect(deleteMany).not.toHaveBeenCalled();
      });
    });

    describe("when the dataset is already on the s3_jsonl layout", () => {
      /** @scenario The storage migration is safe to run more than once */
      it("skips it without writing any chunks (idempotent)", async () => {
        // The re-read inside the lock observes s3_jsonl (already migrated).
        const row = makeDataset({ contentLayout: "s3_jsonl" });
        const { prisma, update } = makePrisma(row);
        const writeChunks = vi.fn();
        const findDatasetRecords = vi.fn();
        const deps = makeDeps({
          prisma: prisma as never,
          recordRepository: { findDatasetRecords } as never,
          getStorage: vi.fn().mockResolvedValue(makeStorage(writeChunks)),
        });

        const outcome = await migrateDatasetToS3(
          {
            dataset: makeDataset({ contentLayout: "postgres" }),
            projectId: "p1",
          },
          deps,
        );

        expect(outcome).toBe("already-migrated");
        expect(writeChunks).not.toHaveBeenCalled();
        expect(findDatasetRecords).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
      });
    });

    describe("when the project resolves to local filesystem storage (no S3)", () => {
      it("migrates the dataset to the local backend (S3 preferred, local fallback)", async () => {
        const row = makeDataset({ contentLayout: "postgres" });
        const { prisma, executeRaw } = makePrisma(row);
        const findDatasetRecords = vi
          .fn()
          .mockResolvedValue([makeRecord("rec_a", { q: "1" })]);
        const writeChunks = vi
          .fn()
          .mockResolvedValue([
            { index: 0, rowCount: 1, byteSize: 20, startRow: 0, endRow: 1 },
          ]);
        const deps = makeDeps({
          prisma: prisma as never,
          recordRepository: { findDatasetRecords } as never,
          resolveStorage: vi
            .fn()
            .mockResolvedValue({ kind: "file", root: "/x" }),
          getStorage: vi.fn().mockResolvedValue(makeStorage(writeChunks)),
        });

        const outcome = await migrateDatasetToS3(
          { dataset: row, projectId: "p1" },
          deps,
        );

        expect(outcome).toBe("migrated");
        expect(writeChunks).toHaveBeenCalled();
        // The advisory lock IS taken for the local-FS migration.
        expect(executeRaw).toHaveBeenCalled();
      });
    });

    describe("in dry-run mode", () => {
      it("reports the dataset without taking the lock, writing chunks, or flipping it", async () => {
        const row = makeDataset({ contentLayout: "postgres" });
        const { prisma, update, executeRaw } = makePrisma(row);
        const writeChunks = vi.fn();
        const deps = makeDeps({
          prisma: prisma as never,
          getStorage: vi.fn().mockResolvedValue(makeStorage(writeChunks)),
        });

        const outcome = await migrateDatasetToS3(
          { dataset: row, projectId: "p1" },
          deps,
          { dryRun: true },
        );

        expect(outcome).toBe("would-migrate");
        expect(writeChunks).not.toHaveBeenCalled();
        // No advisory lock and no contentLayout flip.
        expect(executeRaw).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
      });
    });
  });

  describe("migrateAllPostgresDatasets()", () => {
    describe("when SKIP_DATASET_S3_MIGRATE is set", () => {
      it("no-ops entirely (the task returns before touching the DB)", async () => {
        process.env.SKIP_DATASET_S3_MIGRATE = "1";
        // The SKIP guard returns before any DB / storage access — observable as
        // the mocked prisma.project.findMany (the project walk) never being called.
        await expect(execute()).resolves.toBeUndefined();
        expect(
          (
            mockedPrisma as unknown as {
              project: { findMany: ReturnType<typeof vi.fn> };
            }
          ).project.findMany,
        ).not.toHaveBeenCalled();
      });
    });

    describe("when the schema migration has not run yet (column missing)", () => {
      it("self-skips cleanly (exit 0) instead of throwing and failing the Helm release", async () => {
        // The post-upgrade hook can race the app-boot migration: the scan
        // selecting `contentLayout` errors with P2022 ("column does not exist").
        // execute() must swallow it and return, not throw.
        const p2022 = new Prisma.PrismaClientKnownRequestError(
          "The column `Dataset.contentLayout` does not exist in the current database.",
          { code: "P2022", clientVersion: "test" },
        );
        const pm = mockedPrisma as unknown as {
          project: { findMany: ReturnType<typeof vi.fn> };
          dataset: { findMany: ReturnType<typeof vi.fn> };
        };
        pm.project.findMany.mockResolvedValueOnce([{ id: "p1" }]);
        pm.dataset.findMany.mockRejectedValueOnce(p2022);

        await expect(execute()).resolves.toBeUndefined();
      });
    });

    describe("when there are postgres datasets across pages", () => {
      it("tallies migrated / already-migrated outcomes", async () => {
        const d1 = makeDataset({ id: "d1", contentLayout: "postgres" });
        const d2 = makeDataset({ id: "d2", contentLayout: "postgres" });

        // One project; its first dataset page returns two, the second is empty
        // → loop terminates. The per-dataset lock is a separate tx-scoped
        // $executeRaw. Datasets are queried per-project WITH projectId (the
        // middleware requires it); the project list is the exempt walk.
        const projectFindMany = vi.fn().mockResolvedValue([{ id: "p1" }]);
        const datasetFindMany = vi
          .fn()
          .mockResolvedValueOnce([
            {
              id: "d1",
              projectId: "p1",
              contentLayout: "postgres",
              status: "ready",
            },
            {
              id: "d2",
              projectId: "p1",
              contentLayout: "postgres",
              status: "ready",
            },
          ])
          .mockResolvedValueOnce([]);

        // Per-dataset transaction stub: d1 → s3, d2 → local FS, both migrate.
        const update = vi.fn().mockResolvedValue(undefined);
        const lockExecuteRaw = vi.fn().mockResolvedValue([]);
        const prisma = {
          project: { findMany: projectFindMany },
          dataset: { findMany: datasetFindMany },
          $transaction: vi.fn(async (fn: (t: unknown) => unknown) =>
            fn({
              $executeRaw: lockExecuteRaw,
              dataset: {
                findFirst: vi.fn().mockResolvedValue(d1),
                update,
              },
            }),
          ),
        };

        const writeChunks = vi
          .fn()
          .mockResolvedValue([
            { index: 0, rowCount: 1, byteSize: 10, startRow: 0, endRow: 1 },
          ]);
        const deps = makeDeps({
          prisma: prisma as never,
          recordRepository: {
            findDatasetRecords: vi
              .fn()
              .mockResolvedValue([makeRecord("r", { a: 1 })]),
          } as never,
          resolveStorage: vi
            .fn()
            .mockResolvedValueOnce({ kind: "s3", bucket: "b" }) // d1 → s3
            .mockResolvedValueOnce({ kind: "file", root: "/x" }), // d2 → local FS
          getStorage: vi.fn().mockResolvedValue(makeStorage(writeChunks)),
        });

        const summary = await migrateAllPostgresDatasets(deps);

        expect(summary).toEqual({
          migrated: 2,
          wouldMigrate: 0,
          alreadyMigrated: 0,
          failed: 0,
        });
        // d2's id reference keeps the linter happy that both fixtures are used.
        expect(d2.id).toBe("d2");
      });
    });

    describe("when a single dataset migration throws", () => {
      it("counts it as failed and continues (idempotent — retried next run)", async () => {
        const findMany = vi
          .fn()
          .mockResolvedValueOnce([
            {
              id: "d1",
              projectId: "p1",
              contentLayout: "postgres",
              status: "ready",
            },
          ])
          .mockResolvedValueOnce([]);
        const prisma = {
          project: { findMany: vi.fn().mockResolvedValue([{ id: "p1" }]) },
          dataset: { findMany },
          $transaction: vi.fn(async () => {
            throw new Error("S3 write failed");
          }),
        };
        const deps = makeDeps({
          prisma: prisma as never,
          resolveStorage: vi
            .fn()
            .mockResolvedValue({ kind: "s3", bucket: "b" }),
          getStorage: vi.fn().mockResolvedValue(makeStorage(vi.fn())),
        });

        const summary = await migrateAllPostgresDatasets(deps);

        expect(summary.failed).toBe(1);
        expect(summary.migrated).toBe(0);
      });
    });
  });
});
