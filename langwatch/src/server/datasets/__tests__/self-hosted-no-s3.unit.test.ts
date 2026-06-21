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
