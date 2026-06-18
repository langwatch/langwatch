import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock only the boundaries: the storage accessor (S3/local) and the
// createManyDatasetRecords write seam (PG insert). The service logic under test
// (s3_jsonl read routing + status gating) stays real.
vi.mock("../dataset-storage", () => ({ getDatasetStorage: vi.fn() }));
vi.mock("../dataset-normalize.queue", () => ({
  enqueueDatasetNormalize: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../api/routers/datasetRecord.utils", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../api/routers/datasetRecord.utils")
    >();
  return { ...actual, createManyDatasetRecords: vi.fn() };
});

import { createManyDatasetRecords } from "../../api/routers/datasetRecord.utils";
import { DatasetService } from "../dataset.service";
import { getDatasetStorage } from "../dataset-storage";

const makeService = (overrides: {
  repository?: Record<string, unknown>;
  recordRepository?: Record<string, unknown>;
  prisma?: unknown;
}) => {
  const service = new DatasetService(
    {} as never,
    (overrides.repository ?? {}) as never,
    (overrides.recordRepository ?? {}) as never,
    {} as never,
  );
  if (overrides.prisma) {
    (service as unknown as { prisma: unknown }).prisma = overrides.prisma;
  }
  return service;
};

/**
 * A prisma stub whose `$transaction(fn)` runs `fn(tx)` with a tx that returns
 * `row` from `findFirstOrThrow` (the advisory-lock seam the s3_jsonl write
 * mutations open). Lets a service write path reach `assertReady` for real.
 */
const makeLockPrisma = (row: Record<string, unknown>) => ({
  $transaction: async (fn: (tx: unknown) => unknown) =>
    fn({
      $queryRaw: async () => [],
      dataset: {
        findFirstOrThrow: async () => ({ ...row }),
        update: async () => ({ ...row }),
      },
    }),
});

const baseS3Dataset = {
  id: "dataset_1",
  projectId: "p1",
  name: "DS",
  slug: "ds",
  columnTypes: [{ name: "a", type: "string" }],
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
  contentLayout: "s3_jsonl",
  status: "ready",
  statusError: null,
  rowCount: 2,
  chunkCount: 1,
};

const mockReadChunks = (rows: unknown[]) => {
  const readChunks = vi.fn().mockResolvedValue(rows);
  vi.mocked(getDatasetStorage).mockResolvedValue({ readChunks } as never);
  return readChunks;
};

beforeEach(() => vi.clearAllMocks());

describe("DatasetService", () => {
  describe("listRecords()", () => {
    describe("when the dataset is s3_jsonl and ready", () => {
      it("reads chunks, paginates in-memory, and reports the PG row count", async () => {
        const repository = {
          findBySlugOrId: vi.fn().mockResolvedValue({ ...baseS3Dataset }),
        };
        const recordRepository = { listPaginated: vi.fn() };
        const readChunks = mockReadChunks([
          { id: "r1", entry: { a: 1 } },
          { id: "r2", entry: { a: 2 } },
        ]);

        const result = await makeService({
          repository,
          recordRepository,
        }).listRecords({ slugOrId: "ds", projectId: "p1", page: 1, limit: 1 });

        expect(readChunks).toHaveBeenCalledWith({
          projectId: "p1",
          datasetId: "dataset_1",
          chunkCount: 1,
        });
        // page 1, limit 1 → first record only; total is PG-authoritative.
        expect(result.data).toHaveLength(1);
        expect(result.data[0]?.id).toBe("r1");
        expect(result.pagination.total).toBe(2);
        // The PG paginator must NOT be touched for s3_jsonl.
        expect(recordRepository.listPaginated).not.toHaveBeenCalled();
      });
    });

    describe("when the dataset is s3_jsonl but still processing", () => {
      it("throws DatasetNotReadyError instead of returning empty", async () => {
        const repository = {
          findBySlugOrId: vi
            .fn()
            .mockResolvedValue({ ...baseS3Dataset, status: "processing" }),
        };
        const readChunks = mockReadChunks([]);

        await expect(
          makeService({ repository }).listRecords({
            slugOrId: "ds",
            projectId: "p1",
            page: 1,
            limit: 10,
          }),
        ).rejects.toMatchObject({
          name: "DatasetNotReadyError",
          status: "processing",
        });
        expect(readChunks).not.toHaveBeenCalled();
      });
    });

    describe("when the dataset is postgres", () => {
      it("routes through the PG paginator unchanged", async () => {
        const repository = {
          findBySlugOrId: vi.fn().mockResolvedValue({
            ...baseS3Dataset,
            contentLayout: "postgres",
          }),
        };
        const recordRepository = {
          listPaginated: vi
            .fn()
            .mockResolvedValue({ records: [{ id: "pg1" }], total: 1 }),
        };

        const result = await makeService({
          repository,
          recordRepository,
        }).listRecords({ slugOrId: "ds", projectId: "p1", page: 1, limit: 10 });

        expect(recordRepository.listPaginated).toHaveBeenCalledOnce();
        expect(result.data).toEqual([{ id: "pg1" }]);
        expect(getDatasetStorage).not.toHaveBeenCalled();
      });
    });
  });

  // M1/M5: a write to a still-preparing s3_jsonl dataset must surface
  // DatasetNotReadyError (the route maps it to 425; tRPC to PRECONDITION_FAILED)
  // — never silently append/edit/delete against a half-prepared dataset
  // (I-READY). The write paths reach `assertReady` inside the advisory lock.
  describe("write paths against a not-ready s3_jsonl dataset", () => {
    const notReadyRow = { ...baseS3Dataset, status: "processing" };

    describe("upsertRecord()", () => {
      it("throws DatasetNotReadyError instead of editing the chunk", async () => {
        const repository = {
          findBySlugOrId: vi.fn().mockResolvedValue({ ...notReadyRow }),
        };
        vi.mocked(getDatasetStorage).mockResolvedValue({
          readChunk: vi.fn(),
          rewriteChunk: vi.fn(),
          writeChunks: vi.fn(),
        } as never);

        await expect(
          makeService({
            repository,
            prisma: makeLockPrisma(notReadyRow),
          }).upsertRecord({
            slugOrId: "ds",
            projectId: "p1",
            recordId: "r1",
            entry: { a: 1 },
          }),
        ).rejects.toMatchObject({
          name: "DatasetNotReadyError",
          status: "processing",
        });
      });
    });

    describe("deleteRecords()", () => {
      it("throws DatasetNotReadyError instead of rewriting chunks", async () => {
        const repository = {
          findBySlugOrId: vi.fn().mockResolvedValue({ ...notReadyRow }),
        };
        vi.mocked(getDatasetStorage).mockResolvedValue({
          readChunk: vi.fn(),
          rewriteChunk: vi.fn(),
        } as never);

        await expect(
          makeService({
            repository,
            prisma: makeLockPrisma(notReadyRow),
          }).deleteRecords({
            slugOrId: "ds",
            projectId: "p1",
            recordIds: ["r1"],
          }),
        ).rejects.toMatchObject({
          name: "DatasetNotReadyError",
          status: "processing",
        });
      });
    });
  });

  describe("copyDataset()", () => {
    describe("when the source is s3_jsonl and ready", () => {
      it("reads source rows from chunks (not the empty PG table) into the new dataset", async () => {
        const create = vi
          .fn()
          .mockResolvedValue({ id: "dataset_new", slug: "ds-copy" });
        const repository = {
          findOne: vi.fn().mockResolvedValue({ ...baseS3Dataset }),
          findAllSlugs: vi.fn().mockResolvedValue([]),
          findBySlug: vi.fn().mockResolvedValue(null),
          getProjectWithOrgS3Settings: vi
            .fn()
            .mockResolvedValue({ canUseS3: false }),
          create,
        };
        const recordRepository = { findDatasetRecords: vi.fn() };
        // $transaction passthrough so createNewDataset runs.
        const service = makeService({ repository, recordRepository });
        (service as unknown as { prisma: unknown }).prisma = {
          $transaction: async (fn: (tx: unknown) => unknown) => fn({}),
        };
        mockReadChunks([
          { id: "r1", entry: { a: 1 } },
          { id: "r2", entry: { a: 2 } },
        ]);

        await service.copyDataset({
          sourceDatasetId: "dataset_1",
          sourceProjectId: "p1",
          targetProjectId: "p2",
        });

        // The PG record reader must NOT be used for an s3_jsonl source.
        expect(recordRepository.findDatasetRecords).not.toHaveBeenCalled();
        // The copied entries come from the chunk lines' `entry` (unwrapped),
        // each with a fresh id — proving the read came from S3, not empty PG.
        expect(create).toHaveBeenCalled();
        const copiedEntries = vi.mocked(createManyDatasetRecords).mock
          .calls[0]![0].datasetRecords;
        expect(copiedEntries).toHaveLength(2);
        expect(copiedEntries[0]).toMatchObject({ a: 1 });
        expect(copiedEntries[1]).toMatchObject({ a: 2 });
      });
    });

    describe("when the source is s3_jsonl but not ready", () => {
      it("throws DatasetNotReadyError rather than copying an empty dataset", async () => {
        const repository = {
          findOne: vi
            .fn()
            .mockResolvedValue({ ...baseS3Dataset, status: "failed" }),
        };

        await expect(
          makeService({ repository }).copyDataset({
            sourceDatasetId: "dataset_1",
            sourceProjectId: "p1",
            targetProjectId: "p2",
          }),
        ).rejects.toMatchObject({ name: "DatasetNotReadyError" });
      });
    });
  });
});
