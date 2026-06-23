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
import { DatasetChunkCountMissingError } from "../errors";

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
      $executeRaw: async () => [],
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

/**
 * Mock storage for the offset-aware pagination: `readChunk(index)` resolves the
 * rows of `chunksByIndex[index]`; `readChunks` is a spy that must NOT be called
 * when offsets are present (we read only the overlapping chunk(s)).
 */
const mockReadChunk = (chunksByIndex: Record<number, unknown[]>) => {
  const readChunks = vi.fn();
  const readChunk = vi.fn(({ index }: { index: number }) =>
    Promise.resolve(chunksByIndex[index] ?? []),
  );
  vi.mocked(getDatasetStorage).mockResolvedValue({
    readChunks,
    readChunk,
  } as never);
  return { readChunks, readChunk };
};

beforeEach(() => vi.clearAllMocks());

describe("DatasetService", () => {
  describe("listRecords()", () => {
    describe("when the dataset is s3_jsonl and ready (no offsets — legacy)", () => {
      it("falls back to reading all chunks and slices the page", async () => {
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

        // No offsets on baseS3Dataset → defensive whole-read fallback.
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

    describe("when a ready s3_jsonl dataset has a null chunkCount and no offsets (I-COUNT drift)", () => {
      it("throws DatasetChunkCountMissingError instead of serving an empty page against a positive rowCount", async () => {
        const repository = {
          findBySlugOrId: vi.fn().mockResolvedValue({
            ...baseS3Dataset,
            chunkCount: null,
            rowCount: 5,
          }),
        };
        // Storage is stubbed but the guard must fire BEFORE any chunk read — a
        // `chunkCount ?? 0` would otherwise loop zero times and return [] (empty
        // page) while total=5: silent data loss.
        const readChunks = mockReadChunks([]);

        await expect(
          makeService({ repository }).listRecords({
            slugOrId: "ds",
            projectId: "p1",
            page: 1,
            limit: 10,
          }),
        ).rejects.toBeInstanceOf(DatasetChunkCountMissingError);
        expect(readChunks).not.toHaveBeenCalled();
      });
    });

    // P2#1 — with chunkOffsets present, a page request reads ONLY the chunk(s)
    // whose [startRow, endRow) overlap the page window — never non-overlapping
    // chunks of a multi-GB dataset (I-MEM).
    describe("when the dataset is s3_jsonl with offsets and a page falls in the second chunk", () => {
      it("reads only the overlapping chunk (index 1), never the others", async () => {
        const offsetDataset = {
          ...baseS3Dataset,
          rowCount: 6,
          chunkCount: 3,
          chunkOffsets: [
            { index: 0, startRow: 0, endRow: 2, byteSize: 100 },
            { index: 1, startRow: 2, endRow: 4, byteSize: 100 },
            { index: 2, startRow: 4, endRow: 6, byteSize: 100 },
          ],
        };
        const repository = {
          findBySlugOrId: vi.fn().mockResolvedValue({ ...offsetDataset }),
        };
        const recordRepository = { listPaginated: vi.fn() };
        const { readChunks, readChunk } = mockReadChunk({
          0: [
            { id: "r1", entry: { a: 1 } },
            { id: "r2", entry: { a: 2 } },
          ],
          1: [
            { id: "r3", entry: { a: 3 } },
            { id: "r4", entry: { a: 4 } },
          ],
          2: [
            { id: "r5", entry: { a: 5 } },
            { id: "r6", entry: { a: 6 } },
          ],
        });

        // page 2, limit 2 → global rows [2,4) → chunk 1 only.
        const result = await makeService({
          repository,
          recordRepository,
        }).listRecords({ slugOrId: "ds", projectId: "p1", page: 2, limit: 2 });

        expect(readChunk).toHaveBeenCalledTimes(1);
        expect(readChunk).toHaveBeenCalledWith({
          projectId: "p1",
          datasetId: "dataset_1",
          index: 1,
        });
        expect(readChunks).not.toHaveBeenCalled();
        expect(result.data.map((r) => r.id)).toEqual(["r3", "r4"]);
        expect(result.pagination.total).toBe(6);
        expect(recordRepository.listPaginated).not.toHaveBeenCalled();
      });
    });

    describe("when the page window straddles two chunks", () => {
      it("reads both overlapping chunks and slices the exact rows", async () => {
        const offsetDataset = {
          ...baseS3Dataset,
          rowCount: 6,
          chunkCount: 3,
          chunkOffsets: [
            { index: 0, startRow: 0, endRow: 2, byteSize: 100 },
            { index: 1, startRow: 2, endRow: 4, byteSize: 100 },
            { index: 2, startRow: 4, endRow: 6, byteSize: 100 },
          ],
        };
        const repository = {
          findBySlugOrId: vi.fn().mockResolvedValue({ ...offsetDataset }),
        };
        const recordRepository = { listPaginated: vi.fn() };
        const { readChunks, readChunk } = mockReadChunk({
          0: [
            { id: "r1", entry: { a: 1 } },
            { id: "r2", entry: { a: 2 } },
          ],
          1: [
            { id: "r3", entry: { a: 3 } },
            { id: "r4", entry: { a: 4 } },
          ],
          2: [
            { id: "r5", entry: { a: 5 } },
            { id: "r6", entry: { a: 6 } },
          ],
        });

        // page 1, limit 3 → global rows [0,3) → chunks 0 and 1 (chunk 2 untouched).
        const result = await makeService({
          repository,
          recordRepository,
        }).listRecords({ slugOrId: "ds", projectId: "p1", page: 1, limit: 3 });

        expect(readChunk).toHaveBeenCalledTimes(2);
        expect(readChunk).toHaveBeenCalledWith({
          projectId: "p1",
          datasetId: "dataset_1",
          index: 0,
        });
        expect(readChunk).toHaveBeenCalledWith({
          projectId: "p1",
          datasetId: "dataset_1",
          index: 1,
        });
        expect(readChunk).not.toHaveBeenCalledWith({
          projectId: "p1",
          datasetId: "dataset_1",
          index: 2,
        });
        expect(readChunks).not.toHaveBeenCalled();
        expect(result.data.map((r) => r.id)).toEqual(["r1", "r2", "r3"]);
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
          // The injected repo's locked re-read that the mutation asserts ready on.
          findOneOrThrow: vi.fn().mockResolvedValue({ ...notReadyRow }),
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
          // The injected repo's locked re-read that the mutation asserts ready on.
          findOneOrThrow: vi.fn().mockResolvedValue({ ...notReadyRow }),
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

    describe("upsertDataset() editing an existing dataset", () => {
      it("refuses to edit a not-ready dataset, before any slug lookup or mutation", async () => {
        const repository = {
          findOne: vi.fn().mockResolvedValue({ ...notReadyRow }),
          findBySlug: vi.fn(),
        };
        const prisma = {
          $transaction: async (fn: (tx: unknown) => unknown) => fn({}),
        };

        await expect(
          makeService({ repository, prisma }).upsertDataset({
            projectId: "p1",
            datasetId: "dataset_1",
            name: "DS",
            columnTypes: [{ name: "a", type: "string" }],
          }),
        ).rejects.toMatchObject({
          name: "DatasetNotReadyError",
          status: "processing",
        });
        // The ready-gate fires before the slug-conflict lookup / write.
        expect(repository.findBySlug).not.toHaveBeenCalled();
      });
    });
  });

  describe("upsertDataset() changing column types on a ready s3_jsonl dataset", () => {
    it("refuses with a typed ColumnTypeChangeNotSupportedError (a 4xx, not a 500)", async () => {
      // s3_jsonl column migration is a deferred rung; the edit must surface a
      // typed, user-actionable error the router maps to a 4xx — not a plain
      // Error that collapses into a generic 500.
      const repository = {
        findOne: vi.fn().mockResolvedValue({ ...baseS3Dataset }), // ready, cols [a]
        findBySlug: vi.fn().mockResolvedValue(null),
      };
      const prisma = {
        $transaction: async (fn: (tx: unknown) => unknown) => fn({}),
      };

      await expect(
        makeService({ repository, prisma }).upsertDataset({
          projectId: "p1",
          datasetId: "dataset_1",
          name: "DS",
          columnTypes: [{ name: "b", type: "string" }], // changed columns
        }),
      ).rejects.toMatchObject({
        name: "ColumnTypeChangeNotSupportedError",
      });
    });
  });

  describe("copyDataset()", () => {
    describe("when the source is s3_jsonl and ready", () => {
      it("reads source rows from chunks (not the empty PG table) into the new s3_jsonl dataset", async () => {
        const create = vi
          .fn()
          .mockResolvedValue({ id: "dataset_new", slug: "ds-copy" });
        const repository = {
          findOne: vi.fn().mockResolvedValue({ ...baseS3Dataset }),
          findAllSlugs: vi.fn().mockResolvedValue([]),
          findBySlug: vi.fn().mockResolvedValue(null),
          create,
        };
        const recordRepository = { findDatasetRecords: vi.fn() };
        const service = makeService({ repository, recordRepository });

        // The same fake storage serves both the SOURCE read (readChunks) and the
        // born-on-storage WRITE of the target (writeChunks).
        const readChunks = vi.fn().mockResolvedValue([
          { id: "r1", entry: { a: 1 } },
          { id: "r2", entry: { a: 2 } },
        ]);
        const writeChunks = vi.fn(({ records }: { records: unknown[] }) =>
          Promise.resolve([
            {
              index: 0,
              jsonl: "",
              rowCount: records.length,
              byteSize: 1,
              startRow: 0,
              endRow: records.length,
            },
          ]),
        );
        vi.mocked(getDatasetStorage).mockResolvedValue({
          readChunks,
          writeChunks,
        } as never);

        await service.copyDataset({
          sourceDatasetId: "dataset_1",
          sourceProjectId: "p1",
          targetProjectId: "p2",
        });

        // The PG record reader must NOT be used for an s3_jsonl source.
        expect(recordRepository.findDatasetRecords).not.toHaveBeenCalled();
        // Born-on-storage: the target is created s3_jsonl and the copied rows are
        // written to chunk objects (NOT the PG record-write seam).
        expect(create).toHaveBeenCalled();
        expect(create.mock.calls[0]![0]).toMatchObject({
          contentLayout: "s3_jsonl",
          status: "ready",
        });
        expect(createManyDatasetRecords).not.toHaveBeenCalled();
        // The written chunk lines carry the source entries (unwrapped from S3),
        // proving the read came from chunks, not the empty PG table.
        const written = writeChunks.mock.calls[0]![0].records as Array<{
          entry: unknown;
        }>;
        expect(written).toHaveLength(2);
        expect(written[0]!.entry).toMatchObject({ a: 1 });
        expect(written[1]!.entry).toMatchObject({ a: 2 });
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

    describe("when the source is ready s3_jsonl but has a null chunkCount (I-COUNT drift)", () => {
      it("throws DatasetChunkCountMissingError instead of creating an empty copy", async () => {
        const create = vi.fn();
        const repository = {
          findOne: vi.fn().mockResolvedValue({
            ...baseS3Dataset,
            chunkCount: null,
            rowCount: 5,
          }),
          findAllSlugs: vi.fn().mockResolvedValue([]),
          findBySlug: vi.fn().mockResolvedValue(null),
          create,
        };

        await expect(
          makeService({ repository }).copyDataset({
            sourceDatasetId: "dataset_1",
            sourceProjectId: "p1",
            targetProjectId: "p2",
          }),
        ).rejects.toBeInstanceOf(DatasetChunkCountMissingError);
        // No empty copy is created against the positive rowCount.
        expect(create).not.toHaveBeenCalled();
      });
    });
  });
});
