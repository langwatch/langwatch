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
      // via the backend /upload path, which creates a postgres dataset instead.
      expect(repository.create).not.toHaveBeenCalled();
    });
  });

  describe("DatasetService.createDatasetFromUpload() on a no-S3 instance", () => {
    /**
     * The backend upload fallback (≤25MB) must always produce a Postgres-layout
     * dataset — never `s3_jsonl` — when storage isn't S3-backed. This is the
     * fallback the /upload route uses after a direct-upload 409.
     */
    it("creates a postgres-layout dataset and writes rows to PG, never S3", async () => {
      let createdLayout: string | undefined;
      const repository = {
        findBySlug: vi.fn().mockResolvedValue(null),
        getProjectWithOrgS3Settings: vi
          .fn()
          .mockResolvedValue({ canUseS3: false }),
        create: vi
          .fn()
          .mockImplementation((data: { contentLayout?: string }) => {
            createdLayout = data.contentLayout;
            return Promise.resolve({
              id: "dataset_pg",
              name: "DS",
              slug: "ds",
              columnTypes: [{ name: "input", type: "string" }],
              createdAt: new Date(),
              updatedAt: new Date(),
            });
          }),
      };
      // createNewDataset runs inside a $transaction(fn) — run fn with the repo's
      // own client (the repository methods are mocked, so the tx client is unused).
      const prisma = {
        $transaction: async (fn: (tx: unknown) => unknown) => fn({}),
      };

      const result = await makeService({
        repository,
        prisma,
      }).createDatasetFromUpload({
        projectId: "p1",
        name: "DS",
        filename: "data.csv",
        content: "input\nhello\n",
        fileSize: 12,
      });

      expect(result.id).toBe("dataset_pg");
      // Default Prisma `contentLayout` is "postgres"; createNewDataset never sets
      // it to s3_jsonl, so `create` is called WITHOUT an s3_jsonl layout.
      expect(createdLayout).not.toBe("s3_jsonl");
      // Rows go to PG via the record-write seam.
      expect(createManyDatasetRecords).toHaveBeenCalledOnce();
      // The S3 client / dataset storage is never resolved for the PG write path.
      expect(resolveProjectStorageDestination).not.toHaveBeenCalled();
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
