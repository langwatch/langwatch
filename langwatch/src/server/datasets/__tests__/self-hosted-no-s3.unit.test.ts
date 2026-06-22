import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ADR-032 rung 7 — I-SELFHOST: a self-hosted instance with NO object storage
 * configured still fully serves Postgres datasets, and every direct-S3 path
 * degrades gracefully instead of hard-failing.
 *
 * These tests mock the ONE external boundary that decides "is S3 configured" —
 * `resolveProjectStorageDestination` — to a `{ kind: "file" }` (no-S3)
 * destination, and exercise the REAL `getDatasetStorage` factory + the real
 * `DatasetService` upload/read paths on top of it. So they verify the actual
 * gating wiring, not a hand-stubbed storage object.
 *
 * What's proven here (vs. proven elsewhere):
 *   - factory selection (file → LocalDatasetStorage) is covered by
 *     dataset-storage.unit.test.ts; here we prove the *consequences* for the
 *     service flows on a no-S3 instance.
 *   - the route's DirectUploadUnavailable→409 mapping is covered by the route
 *     integration tests; here we prove the service-level error the route maps.
 */

// Boundary mock: the storage-destination resolver. Everything downstream of it
// (the getDatasetStorage factory, LocalDatasetStorage, the presign throw) is
// REAL so the wiring under test is exercised, not faked.
const resolveProjectStorageDestination = vi.fn();
vi.mock("~/server/stored-objects/project-storage-destination", () => ({
  resolveProjectStorageDestination: (projectId: string) =>
    resolveProjectStorageDestination(projectId),
}));

// Boundary mock: the PG record-write seam (a thin DB insert wrapper). The
// service's layout-routing logic that decides whether to call it stays real.
vi.mock("../../api/routers/datasetRecord.utils", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../api/routers/datasetRecord.utils")
    >();
  return { ...actual, createManyDatasetRecords: vi.fn() };
});

// Boundary mock: the normalize enqueue seam (no queue/worker in a unit test).
vi.mock("../dataset-normalize.queue", () => ({
  enqueueDatasetNormalize: vi.fn().mockResolvedValue(undefined),
}));

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { nanoid } from "nanoid";
import { createManyDatasetRecords } from "../../api/routers/datasetRecord.utils";
import { DatasetService } from "../dataset.service";
import * as datasetStorageModule from "../dataset-storage";
import { getDatasetStorage } from "../dataset-storage";
import { DirectUploadUnavailableError } from "../errors";
import { LocalDatasetStorage } from "../local-dataset-storage";

/** A no-S3 (single-replica self-host) storage destination. */
const NO_S3_DESTINATION = {
  kind: "file" as const,
  root: "/var/lib/langwatch/objects",
};

const makeService = (overrides: {
  repository?: Record<string, unknown>;
  recordRepository?: Record<string, unknown>;
  prisma?: unknown;
}) =>
  new DatasetService(
    (overrides.prisma ?? {}) as never,
    (overrides.repository ?? {}) as never,
    (overrides.recordRepository ?? {}) as never,
    {} as never,
  );

beforeEach(() => {
  vi.clearAllMocks();
  // Default every test to the no-S3 shape; individual tests can override.
  resolveProjectStorageDestination.mockResolvedValue(NO_S3_DESTINATION);
});

describe("Feature: Large dataset storage — self-hosted without object storage", () => {
  describe("getDatasetStorage() with no object storage configured", () => {
    it("resolves to the local filesystem backend (never reaches for S3)", async () => {
      const storage = await getDatasetStorage("p1");

      expect(storage).toBeInstanceOf(LocalDatasetStorage);
      expect(resolveProjectStorageDestination).toHaveBeenCalledWith("p1");
    });

    describe("when a heavy direct (browser→S3) upload is requested", () => {
      it("throws DirectUploadUnavailableError so the caller falls back to /upload", async () => {
        const storage = await getDatasetStorage("p1");

        await expect(
          storage.createPresignedUpload({ projectId: "p1" }),
        ).rejects.toBeInstanceOf(DirectUploadUnavailableError);
      });
    });
  });

  describe("DatasetService.createPendingUpload() on a no-S3 instance", () => {
    /** @scenario "Datasets work on a minimal self-hosted install" */
    it("propagates DirectUploadUnavailableError without creating an orphan row", async () => {
      const repository = {
        findBySlug: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      };

      await expect(
        makeService({ repository }).createPendingUpload({
          projectId: "p1",
          name: "DS",
          filename: "data.jsonl",
        }),
      ).rejects.toBeInstanceOf(DirectUploadUnavailableError);
      // No row is created when the presign is unavailable — the client retries
      // via the backend /upload path, which creates an s3_jsonl dataset on the
      // local filesystem instead (born-on-storage).
      expect(repository.create).not.toHaveBeenCalled();
    });
  });

  describe("DatasetService.createDatasetFromUpload() on a no-S3 instance", () => {
    /**
     * Born-on-storage (ADR-032 cutover step 1): the backend upload fallback
     * (≤25MB) now creates an `s3_jsonl` dataset on the LOCAL filesystem even with
     * no S3 configured — `postgres` is never created for new data. The chunk
     * write lands on the resolver-provided `file` root via the real
     * `LocalDatasetStorage`, and records never touch the PG record-write seam.
     */
    /** @scenario A new dataset is created directly in object storage */
    it("creates an s3_jsonl dataset on local FS, never PG, even with no S3", async () => {
      const root = path.join(os.tmpdir(), `lw-ds-no-s3-${nanoid()}`);
      resolveProjectStorageDestination.mockResolvedValue({
        kind: "file" as const,
        root,
      });

      let created: {
        id?: string;
        contentLayout?: string;
        status?: string;
        rowCount?: number;
        chunkCount?: number;
      } = {};
      const repository = {
        findBySlug: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation((data: typeof created) => {
          created = data;
          return Promise.resolve({
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }),
      };

      const result = await makeService({
        repository,
        prisma: {},
      }).createDatasetFromUpload({
        projectId: "p1",
        name: "DS",
        filename: "data.csv",
        content: "input\nhello\n",
        fileSize: 12,
      });

      // Born s3_jsonl + ready, with PG-authoritative counters from the chunk write.
      expect(created.contentLayout).toBe("s3_jsonl");
      expect(created.status).toBe("ready");
      expect(created.rowCount).toBe(1);
      expect(created.chunkCount).toBe(1);
      // Records go to chunk objects, NOT the PG record-write seam.
      expect(createManyDatasetRecords).not.toHaveBeenCalled();
      // The chunk actually landed on the local filesystem under the resolved root.
      const storage = await getDatasetStorage("p1");
      const rows = await storage.readChunks({
        projectId: "p1",
        datasetId: result.id,
        chunkCount: 1,
      });
      expect(rows).toHaveLength(1);
      expect((rows[0] as { entry: unknown }).entry).toEqual({ input: "hello" });

      await fs.rm(root, { recursive: true, force: true });
    });
  });

  describe("DatasetService.upsertDataset() empty create on a no-S3 instance", () => {
    it("borns an empty s3_jsonl dataset (0 chunks, ready) and reads back empty", async () => {
      const root = path.join(os.tmpdir(), `lw-ds-empty-${nanoid()}`);
      resolveProjectStorageDestination.mockResolvedValue({
        kind: "file" as const,
        root,
      });
      let created: {
        id?: string;
        contentLayout?: string;
        status?: string;
        rowCount?: number;
        chunkCount?: number;
      } = {};
      const repository = {
        findBySlug: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation((data: typeof created) => {
          created = data;
          return Promise.resolve({
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }),
      };

      const dataset = await makeService({
        repository,
        prisma: {},
      }).upsertDataset({
        projectId: "p1",
        name: "Empty DS",
        columnTypes: [{ name: "input", type: "string" }],
      });

      // Born s3_jsonl + ready with zero chunks — no records to write.
      expect(created.contentLayout).toBe("s3_jsonl");
      expect(created.status).toBe("ready");
      expect(created.rowCount).toBe(0);
      expect(created.chunkCount).toBe(0);
      expect(createManyDatasetRecords).not.toHaveBeenCalled();
      // A 0-chunk dataset reads back empty without throwing.
      const storage = await getDatasetStorage("p1");
      const rows = await storage.readChunks({
        projectId: "p1",
        datasetId: dataset.id,
        chunkCount: 0,
      });
      expect(rows).toEqual([]);

      await fs.rm(root, { recursive: true, force: true });
    });
  });

  describe("DatasetService.upsertDataset() when the chunk write fails during create", () => {
    /**
     * Born-on-storage writes the chunk objects BEFORE inserting the row, so a
     * chunk-write failure must throw and leave NO orphan row (the old
     * record-insert transaction left an orphan that wedged name reuse). Mock the
     * storage factory so the FIRST create's `writeChunks` rejects, then a real
     * local-FS storage for the retry — proving the failed create wrote no row and
     * the same name is immediately reusable.
     */
    /** @scenario A failed dataset create writes no orphan row */
    /** @scenario Retrying a failed dataset create reuses the same name */
    it("throws without creating a row, then a retry with the same name succeeds", async () => {
      const root = path.join(os.tmpdir(), `lw-ds-atomic-${nanoid()}`);
      resolveProjectStorageDestination.mockResolvedValue({
        kind: "file" as const,
        root,
      });

      // First create's storage write rejects; every later call falls through to
      // the REAL local-FS factory (so the retry actually writes a chunk).
      const realGetDatasetStorage = datasetStorageModule.getDatasetStorage;
      const storageSpy = vi
        .spyOn(datasetStorageModule, "getDatasetStorage")
        .mockResolvedValueOnce({
          writeChunks: vi
            .fn()
            .mockRejectedValue(new Error("storage write failed")),
        } as never)
        .mockImplementation((projectId: string) =>
          realGetDatasetStorage(projectId),
        );

      const repository = {
        findBySlug: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation((data: { id: string }) =>
          Promise.resolve({
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        ),
      };
      const service = makeService({ repository, prisma: {} });

      // The chunk write fails → the whole create rejects.
      await expect(
        service.upsertDataset({
          projectId: "p1",
          name: "Atomic DS",
          columnTypes: [{ name: "input", type: "string" }],
          datasetRecords: [{ input: "would fail to write" }],
        }),
      ).rejects.toThrow("storage write failed");
      // No orphan row: the row is inserted only AFTER the chunk write succeeds.
      expect(repository.create).not.toHaveBeenCalled();

      // The retry with the SAME name succeeds (real storage) — the "already
      // exists" wedge is gone because the failed create wrote no row.
      const followUp = await service.upsertDataset({
        projectId: "p1",
        name: "Atomic DS",
        columnTypes: [{ name: "input", type: "string" }],
        datasetRecords: [{ input: "now valid" }],
      });
      expect(followUp.slug).toBe("atomic-ds");
      expect(repository.create).toHaveBeenCalledOnce();

      storageSpy.mockRestore();
      await fs.rm(root, { recursive: true, force: true });
    });
  });

  describe("DatasetService.upsertDataset() when the row insert fails after chunks are written", () => {
    /**
     * Born-on-storage writes chunks BEFORE the row. If the row insert then fails
     * (slug race → `@@unique` violation, DB outage), the just-written objects
     * would be orphaned customer content with no row to govern retention — the
     * create best-effort reaps them before surfacing the error.
     */
    it("reaps the orphaned chunk objects when the row insert fails", async () => {
      const root = path.join(os.tmpdir(), `lw-ds-f2-${nanoid()}`);
      resolveProjectStorageDestination.mockResolvedValue({
        kind: "file" as const,
        root,
      });

      let datasetId: string | undefined;
      const repository = {
        findBySlug: vi.fn().mockResolvedValue(null),
        // Slug check passed, but the insert hits the unique constraint (a race).
        create: vi.fn().mockImplementation((data: { id: string }) => {
          datasetId = data.id;
          return Promise.reject(new Error("unique constraint violation"));
        }),
      };

      await expect(
        makeService({ repository, prisma: {} }).upsertDataset({
          projectId: "p1",
          name: "Race DS",
          columnTypes: [{ name: "input", type: "string" }],
          datasetRecords: [{ input: "hello" }],
        }),
      ).rejects.toThrow("unique constraint violation");

      // The chunk written before the failed insert was reaped — no orphan content
      // left in storage. readChunks now hits the deleted chunk-0.
      const storage = await getDatasetStorage("p1");
      await expect(
        storage.readChunks({
          projectId: "p1",
          datasetId: datasetId!,
          chunkCount: 1,
        }),
      ).rejects.toThrow(/Missing dataset chunk/);

      await fs.rm(root, { recursive: true, force: true });
    });
  });

  describe("DatasetService.upsertDataset() when the chunk write fails mid-batch", () => {
    /**
     * Born-on-storage writes chunks sequentially. A failure mid-batch (chunk 0
     * lands, chunk 1 throws) would leave the already-written object as a rowless
     * orphan — the same harm the insert-failure reap guards against.
     * `writeInitialS3JsonlChunks` self-reaps the `0..k` prefix on a write
     * failure, so a failed create leaves nothing behind. End-to-end proof on a
     * real local-FS backend. (Symmetry with "row insert fails after chunks are
     * written".)
     */
    it("reaps the partially-written chunk objects when the write fails mid-batch", async () => {
      const root = path.join(os.tmpdir(), `lw-ds-partial-${nanoid()}`);
      resolveProjectStorageDestination.mockResolvedValue({
        kind: "file" as const,
        root,
      });

      // Capture the REAL local-FS backend before spying, then wrap it: write
      // only the FIRST chunk for real and throw as if the next chunk failed.
      // Deletes delegate to the real backend so the reap actually runs on disk.
      const realStorage = await datasetStorageModule.getDatasetStorage("p1");
      let writtenDatasetId: string | undefined;
      const partialWriteStorage = {
        writeChunks: vi.fn().mockImplementation(async (args: any) => {
          writtenDatasetId = args.datasetId;
          await realStorage.writeChunks({
            ...args,
            records: args.records.slice(0, 1),
          });
          throw new Error("storage write failed mid-batch");
        }),
        deleteChunksFrom: (args: any) => realStorage.deleteChunksFrom(args),
      };
      const storageSpy = vi
        .spyOn(datasetStorageModule, "getDatasetStorage")
        .mockResolvedValue(partialWriteStorage as never);

      const repository = {
        findBySlug: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      };

      await expect(
        makeService({ repository, prisma: {} }).upsertDataset({
          projectId: "p1",
          name: "Partial DS",
          columnTypes: [{ name: "input", type: "string" }],
          datasetRecords: [{ input: "a" }, { input: "b" }],
        }),
      ).rejects.toThrow("storage write failed mid-batch");

      // The row was never inserted — the write threw first.
      expect(repository.create).not.toHaveBeenCalled();
      // The chunk that DID land was reaped: reading it back hits the deleted
      // chunk-0. Without the reap this read would succeed (rowless orphan).
      expect(partialWriteStorage.writeChunks).toHaveBeenCalledOnce();
      await expect(
        realStorage.readChunks({
          projectId: "p1",
          datasetId: writtenDatasetId!,
          chunkCount: 1,
        }),
      ).rejects.toThrow(/Missing dataset chunk/);

      storageSpy.mockRestore();
      await fs.rm(root, { recursive: true, force: true });
    });
  });

  describe("DatasetService.listRecords() for a postgres dataset on a no-S3 instance", () => {
    it("paginates from Postgres and never resolves object storage", async () => {
      const repository = {
        findBySlugOrId: vi.fn().mockResolvedValue({
          id: "dataset_pg",
          projectId: "p1",
          contentLayout: "postgres",
          status: "ready",
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

      expect(result.data).toEqual([{ id: "pg1" }]);
      // The PG-only read path never consults storage configuration at all.
      expect(resolveProjectStorageDestination).not.toHaveBeenCalled();
    });
  });
});
