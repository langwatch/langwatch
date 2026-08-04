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
 * record repository's `findDatasetRecordsPage` is stubbed, the storage
 * destination resolver is stubbed, and Prisma is stubbed at the `$transaction` /
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
    // Top-level findFirst for the OUTSIDE-lock pre-check; the in-lock re-read
    // uses the tx's findFirst (same spy, same row).
    dataset: { findFirst },
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

/**
 * A `findDatasetRecordsPage` stub that yields one page of `records` on the first
 * call and an empty page thereafter — the keyset loop reads until it gets an
 * empty page, so a plain `mockResolvedValue([...])` (same non-empty page every
 * call) would spin forever. For multi-page cases, chain `mockResolvedValueOnce`
 * per page + a trailing `[]` directly instead of using this helper.
 */
const pagedRecords = (records: DatasetRecord[]) =>
  vi.fn().mockResolvedValueOnce(records).mockResolvedValue([]);

const makeDeps = (overrides: Partial<BackfillDeps> = {}): BackfillDeps => {
  const { recordRepository: recordOverride, ...rest } = overrides;
  return {
    prisma: {} as never,
    // Merge the recordRepository so the concurrent-write guard's
    // `countAndMaxUpdatedAt` is always present even when a test overrides the
    // repo with just `findDatasetRecordsPage`. The default returns a constant,
    // so baseline === recheck (no concurrent write) and the flip proceeds —
    // tests that exercise the guard override this with differing values.
    recordRepository: {
      findDatasetRecordsPage: vi.fn().mockResolvedValue([]),
      countAndMaxUpdatedAt: vi
        .fn()
        .mockResolvedValue({ count: 0, maxUpdatedAt: null }),
      ...(recordOverride ?? {}),
    } as never,
    resolveStorage: vi.fn().mockResolvedValue({ kind: "s3", bucket: "b" }),
    getStorage: vi.fn(),
    ...rest,
  } as BackfillDeps;
};

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
        const findDatasetRecordsPage = pagedRecords([
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
          recordRepository: { findDatasetRecordsPage } as never,
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
        const findDatasetRecordsPage = pagedRecords([
          makeRecord("rec_a", { q: "1" }),
        ]);
        const writeChunks = vi.fn().mockResolvedValue([
          { index: 0, rowCount: 1, byteSize: 20, startRow: 0, endRow: 1 },
          { index: 1, rowCount: 1, byteSize: 20, startRow: 1, endRow: 2 },
        ]);
        const deleteChunksFrom = vi.fn().mockResolvedValue(undefined);
        const deps = makeDeps({
          prisma: prisma as never,
          recordRepository: { findDatasetRecordsPage } as never,
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
       * @scenario Migration never silently drops a concurrent write
       *
       * Concurrent-write guard (I-MIG): the migration snapshots the record
       * count + maxUpdatedAt before reading, then re-reads under the lock before
       * the flip. If a record was inserted/deleted (count) or edited in place
       * (maxUpdatedAt) during the snapshot→flip window, the chunks are stale —
       * so it must NOT flip. The dataset stays on `postgres` (still readable)
       * and re-migrates next pass. Off-peak one-off mitigation, not a proof.
       */
      it("skips the flip when the record count changes during migration (insert/delete)", async () => {
        const row = makeDataset({ contentLayout: "postgres" });
        const { prisma, update } = makePrisma(row);
        const findDatasetRecordsPage = pagedRecords([
          makeRecord("rec_a", { q: "1" }),
          makeRecord("rec_b", { q: "2" }),
        ]);
        const writeChunks = vi
          .fn()
          .mockResolvedValue([
            { index: 0, rowCount: 2, byteSize: 42, startRow: 0, endRow: 2 },
          ]);
        const at = new Date("2026-06-23T00:00:00Z");
        // Baseline (pre-read) sees 2 rows; the under-lock re-read sees 3 — a row
        // was inserted mid-migration.
        const countAndMaxUpdatedAt = vi
          .fn()
          .mockResolvedValueOnce({ count: 2, maxUpdatedAt: at })
          .mockResolvedValueOnce({ count: 3, maxUpdatedAt: at });
        const deps = makeDeps({
          prisma: prisma as never,
          recordRepository: {
            findDatasetRecordsPage,
            countAndMaxUpdatedAt,
          } as never,
          getStorage: vi.fn().mockResolvedValue(makeStorage(writeChunks)),
        });

        const outcome = await migrateDatasetToS3(
          { dataset: row, projectId: "p1" },
          deps,
        );

        expect(outcome).toBe("skipped-concurrent-write");
        // Crucially: the dataset is NOT flipped (no stale snapshot committed).
        expect(update).not.toHaveBeenCalled();
      });

      it("skips the flip when a row is edited in place during migration (same count, newer updatedAt)", async () => {
        const row = makeDataset({ contentLayout: "postgres" });
        const { prisma, update } = makePrisma(row);
        const findDatasetRecordsPage = pagedRecords([
          makeRecord("rec_a", { q: "1" }),
        ]);
        const writeChunks = vi
          .fn()
          .mockResolvedValue([
            { index: 0, rowCount: 1, byteSize: 20, startRow: 0, endRow: 1 },
          ]);
        // Same count both reads, but the latest updatedAt advanced → an in-place
        // edit landed; count alone would miss it, maxUpdatedAt catches it.
        const countAndMaxUpdatedAt = vi
          .fn()
          .mockResolvedValueOnce({
            count: 1,
            maxUpdatedAt: new Date("2026-06-23T00:00:00Z"),
          })
          .mockResolvedValueOnce({
            count: 1,
            maxUpdatedAt: new Date("2026-06-23T00:05:00Z"),
          });
        const deps = makeDeps({
          prisma: prisma as never,
          recordRepository: {
            findDatasetRecordsPage,
            countAndMaxUpdatedAt,
          } as never,
          getStorage: vi.fn().mockResolvedValue(makeStorage(writeChunks)),
        });

        const outcome = await migrateDatasetToS3(
          { dataset: row, projectId: "p1" },
          deps,
        );

        expect(outcome).toBe("skipped-concurrent-write");
        expect(update).not.toHaveBeenCalled();
      });

      /**
       * @scenario An existing dataset stays usable after the storage migration
       *
       * "The same rows as before" includes row ORDER. The deterministic
       * `createdAt asc, id asc` order is enforced at the `findDatasetRecordsPage`
       * repository read (asserted in dataset-record.repository.unit.test.ts);
       * this guards the migration SIDE of the contract: it must write rows in
       * exactly the order the repo returns them — never re-sorting or
       * reshuffling — so chunk/row order matches the PG read paths and is stable
       * across crash-resume re-runs.
       */
      it("writes rows to S3 in the exact order findDatasetRecordsPage returns them (no reshuffle)", async () => {
        const row = makeDataset({ contentLayout: "postgres" });
        const { prisma } = makePrisma(row);
        // Repo returns rows already in canonical createdAt/id order.
        const findDatasetRecordsPage = pagedRecords([
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
          recordRepository: { findDatasetRecordsPage } as never,
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

      /*
       * The OOM guard for multi-GB / million-row datasets. The migration must
       * keyset-paginate `DatasetRecord` and stream each page into the chunk
       * writer — never a single `findDatasetRecords`-style slurp. This asserts:
       * it reads page-by-page until an empty page, advances the cursor by the
       * previous page's last id, and preserves every row's id across pages.
       */
      /** @scenario A very large dataset migrates without loading every row at once */
      it("streams records page-by-page (cursor advances; ids preserved across pages)", async () => {
        const row = makeDataset({ contentLayout: "postgres" });
        const { prisma } = makePrisma(row);
        // Two non-empty pages, then empty → loop terminates. Distinct ids per
        // page so we can assert the cursor seek and cross-page id preservation.
        const findDatasetRecordsPage = vi
          .fn()
          .mockResolvedValueOnce([
            makeRecord("rec_a", { n: 1 }),
            makeRecord("rec_b", { n: 2 }),
          ])
          .mockResolvedValueOnce([
            makeRecord("rec_c", { n: 3 }),
            makeRecord("rec_d", { n: 4 }),
          ])
          .mockResolvedValueOnce([]);
        const writeChunks = vi
          .fn()
          .mockResolvedValue([
            { index: 0, rowCount: 4, byteSize: 80, startRow: 0, endRow: 4 },
          ]);
        const deps = makeDeps({
          prisma: prisma as never,
          recordRepository: { findDatasetRecordsPage } as never,
          getStorage: vi.fn().mockResolvedValue(makeStorage(writeChunks)),
        });

        const outcome = await migrateDatasetToS3(
          { dataset: row, projectId: "p1" },
          deps,
        );

        expect(outcome).toBe("migrated");
        // Read three times: page 1 (no cursor), page 2 (cursor = page 1's last
        // id), page 3 (cursor = page 2's last id) → empty, stop.
        expect(findDatasetRecordsPage).toHaveBeenCalledTimes(3);
        expect(findDatasetRecordsPage.mock.calls[0]![0]).toMatchObject({
          datasetId: "dataset_1",
          projectId: "p1",
          cursorId: undefined,
        });
        expect(findDatasetRecordsPage.mock.calls[1]![0]).toMatchObject({
          cursorId: "rec_b",
        });
        expect(findDatasetRecordsPage.mock.calls[2]![0]).toMatchObject({
          cursorId: "rec_d",
        });
        // All four rows reached the writer, in order, ids preserved.
        const allWritten = writeChunks.mock.calls.flatMap(
          (call) => call[0].records,
        );
        expect(allWritten).toEqual([
          { id: "rec_a", entry: { n: 1 } },
          { id: "rec_b", entry: { n: 2 } },
          { id: "rec_c", entry: { n: 3 } },
          { id: "rec_d", entry: { n: 4 } },
        ]);
      });

      it("does not delete the PG DatasetRecord rows (non-destructive, I-MIG)", async () => {
        const row = makeDataset({ contentLayout: "postgres" });
        const { prisma } = makePrisma(row);
        const deleteMany = vi.fn();
        const findDatasetRecordsPage = pagedRecords([
          makeRecord("rec_a", { q: "1" }),
        ]);
        const writeChunks = vi
          .fn()
          .mockResolvedValue([
            { index: 0, rowCount: 1, byteSize: 20, startRow: 0, endRow: 1 },
          ]);
        const deps = makeDeps({
          prisma: prisma as never,
          recordRepository: { findDatasetRecordsPage, deleteMany } as never,
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
        const findDatasetRecordsPage = vi.fn();
        const deps = makeDeps({
          prisma: prisma as never,
          recordRepository: { findDatasetRecordsPage } as never,
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
        expect(findDatasetRecordsPage).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
      });
    });

    describe("when the dataset uses the legacy useS3 single-blob layout", () => {
      /*
       * useS3 datasets keep their rows in ONE S3 blob, with zero DatasetRecord
       * rows. Migrating one would read zero rows and flip it to an EMPTY
       * s3_jsonl dataset — silent data loss. The backfill must skip them and
       * leave them on the still-live legacy read path.
       */
      /** @scenario A legacy single-blob dataset is left readable, not emptied */
      it("skips it without reading records or writing chunks (no empty-flip data loss)", async () => {
        // contentLayout is still `postgres` (born-on-storage default) but the
        // legacy blob flag is set — the guard must catch it.
        const row = makeDataset({ contentLayout: "postgres", useS3: true });
        const { prisma, update } = makePrisma(row);
        const writeChunks = vi.fn();
        const findDatasetRecordsPage = vi.fn();
        const deps = makeDeps({
          prisma: prisma as never,
          recordRepository: { findDatasetRecordsPage } as never,
          getStorage: vi.fn().mockResolvedValue(makeStorage(writeChunks)),
        });

        const outcome = await migrateDatasetToS3(
          { dataset: row, projectId: "p1" },
          deps,
        );

        expect(outcome).toBe("already-migrated");
        expect(findDatasetRecordsPage).not.toHaveBeenCalled();
        expect(writeChunks).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
      });
    });

    describe("when the project resolves to local filesystem storage (no S3)", () => {
      it("migrates the dataset to the local backend (S3 preferred, local fallback)", async () => {
        const row = makeDataset({ contentLayout: "postgres" });
        const { prisma, executeRaw } = makePrisma(row);
        const findDatasetRecordsPage = pagedRecords([
          makeRecord("rec_a", { q: "1" }),
        ]);
        const writeChunks = vi
          .fn()
          .mockResolvedValue([
            { index: 0, rowCount: 1, byteSize: 20, startRow: 0, endRow: 1 },
          ]);
        const deps = makeDeps({
          prisma: prisma as never,
          recordRepository: { findDatasetRecordsPage } as never,
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
          dataset: {
            findMany: datasetFindMany,
            // Top-level findFirst for each dataset's OUTSIDE-lock pre-check
            // (both d1/d2 are postgres → both proceed to migrate).
            findFirst: vi
              .fn()
              .mockResolvedValue(makeDataset({ contentLayout: "postgres" })),
          },
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
            // Per-dataset: one record page then empty. `mockResolvedValue([])`
            // tail covers BOTH datasets' loops (each reads page → empty).
            findDatasetRecordsPage: vi
              .fn()
              .mockResolvedValueOnce([makeRecord("r", { a: 1 })])
              .mockResolvedValueOnce([])
              .mockResolvedValueOnce([makeRecord("r", { a: 1 })])
              .mockResolvedValue([]),
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
          skippedConcurrentWrite: 0,
          failed: 0,
        });
        // The scan excludes legacy useS3 blob datasets (they'd flip to empty).
        expect(datasetFindMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              contentLayout: "postgres",
              useS3: false,
            }),
          }),
        );
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
          dataset: {
            findMany,
            findFirst: vi
              .fn()
              .mockResolvedValue(makeDataset({ contentLayout: "postgres" })),
          },
          $transaction: vi.fn(async (fn: (t: unknown) => unknown) =>
            fn({
              $executeRaw: vi.fn().mockResolvedValue([]),
              dataset: { findFirst: vi.fn(), update: vi.fn() },
            }),
          ),
        };
        const deps = makeDeps({
          prisma: prisma as never,
          recordRepository: {
            findDatasetRecordsPage: pagedRecords([makeRecord("r", { a: 1 })]),
          } as never,
          resolveStorage: vi
            .fn()
            .mockResolvedValue({ kind: "s3", bucket: "b" }),
          // The S3 write (now OUTSIDE the lock) fails for this dataset.
          getStorage: vi
            .fn()
            .mockResolvedValue(
              makeStorage(
                vi.fn().mockRejectedValue(new Error("S3 write failed")),
              ),
            ),
        });

        const summary = await migrateAllPostgresDatasets(deps);

        expect(summary.failed).toBe(1);
        expect(summary.migrated).toBe(0);
      });
    });
  });
});
