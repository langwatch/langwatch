import { describe, expect, it, vi } from "vitest";
import type { Projection } from "../../domain/types";
import type { TenantId } from "../../domain/tenantId";
import type {
  ProjectionStore,
  ProjectionStoreReadContext,
  ProjectionStoreWriteContext,
} from "../../stores/projectionStore.types";
import { RepositoryFoldStore } from "../repositoryFoldStore";
import type { ProjectionStoreContext } from "../projectionStoreContext";

interface TestData {
  total: number;
  status: string;
  CreatedAt: number;
  UpdatedAt: number;
}

function makeContext(overrides: Partial<ProjectionStoreContext> = {}): ProjectionStoreContext {
  return {
    aggregateId: "agg-1",
    tenantId: "tenant-1" as TenantId,
    ...overrides,
  };
}

function makeMockRepo(): ProjectionStore<Projection<TestData>> & {
  storedProjections: Projection<TestData>[];
  getResult: Projection<TestData> | null;
} {
  const mock = {
    storedProjections: [] as Projection<TestData>[],
    getResult: null as Projection<TestData> | null,
    storeProjection: vi.fn(async (projection: Projection<TestData>) => {
      mock.storedProjections.push(projection);
    }),
    getProjection: vi.fn(async () => mock.getResult),
  };
  return mock;
}

describe("RepositoryFoldStore", () => {
  describe("store()", () => {
    it("wraps state into a Projection envelope and delegates to repository", async () => {
      const repo = makeMockRepo();
      const store = new RepositoryFoldStore<TestData>(repo, "2026-03-01");

      await store.store(
        { total: 5, status: "running", CreatedAt: 1000, UpdatedAt: 2000 },
        makeContext(),
      );

      expect(repo.storeProjection).toHaveBeenCalledOnce();
      const stored = repo.storedProjections[0]!;
      expect(stored.id).toBe("agg-1");
      expect(stored.aggregateId).toBe("agg-1");
      expect(stored.tenantId).toBe("tenant-1");
      expect(stored.version).toBe("2026-03-01");
      expect(stored.data).toEqual({
        total: 5,
        status: "running",
        CreatedAt: 1000,
        UpdatedAt: 2000,
      });
    });

    it("passes tenantId to repository write context", async () => {
      const repo = makeMockRepo();
      const store = new RepositoryFoldStore<TestData>(repo, "2026-03-01");

      await store.store(
        { total: 1, status: "done", CreatedAt: 1000, UpdatedAt: 2000 },
        makeContext({ tenantId: "tenant-42" as TenantId }),
      );

      expect(repo.storeProjection).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ tenantId: "tenant-42" }),
      );
    });
  });

  describe("storeBatch()", () => {
    describe("when repository supports storeProjectionBatch", () => {
      it("delegates to native batch insert with all entries", async () => {
        const repo = makeMockRepo();
        const batchSpy = vi.fn().mockResolvedValue(undefined);
        (repo as any).storeProjectionBatch = batchSpy;
        const store = new RepositoryFoldStore<TestData>(repo, "2026-03-01");

        await store.storeBatch([
          { state: { total: 1, status: "a", CreatedAt: 100, UpdatedAt: 200 }, context: makeContext({ aggregateId: "agg-1" }) },
          { state: { total: 2, status: "b", CreatedAt: 300, UpdatedAt: 400 }, context: makeContext({ aggregateId: "agg-2" }) },
        ]);

        expect(batchSpy).toHaveBeenCalledOnce();
        const projections = batchSpy.mock.calls[0]![0];
        expect(projections).toHaveLength(2);
        expect(projections[0].aggregateId).toBe("agg-1");
        expect(projections[0].data.total).toBe(1);
        expect(projections[1].aggregateId).toBe("agg-2");
        expect(projections[1].data.total).toBe(2);
        // Individual store should NOT be called
        expect(repo.storeProjection).not.toHaveBeenCalled();
      });

      it("passes tenantId from first entry as write context", async () => {
        const repo = makeMockRepo();
        const batchSpy = vi.fn().mockResolvedValue(undefined);
        (repo as any).storeProjectionBatch = batchSpy;
        const store = new RepositoryFoldStore<TestData>(repo, "2026-03-01");

        await store.storeBatch([
          { state: { total: 1, status: "a", CreatedAt: 100, UpdatedAt: 200 }, context: makeContext({ tenantId: "proj_xyz" as TenantId }) },
        ]);

        expect(batchSpy).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ tenantId: "proj_xyz" }),
        );
      });
    });

    describe("when repository does not support storeProjectionBatch", () => {
      it("falls back to sequential store calls", async () => {
        const repo = makeMockRepo();
        const store = new RepositoryFoldStore<TestData>(repo, "2026-03-01");

        await store.storeBatch([
          { state: { total: 1, status: "a", CreatedAt: 100, UpdatedAt: 200 }, context: makeContext({ aggregateId: "agg-1" }) },
          { state: { total: 2, status: "b", CreatedAt: 300, UpdatedAt: 400 }, context: makeContext({ aggregateId: "agg-2" }) },
        ]);

        expect(repo.storeProjection).toHaveBeenCalledTimes(2);
        expect(repo.storedProjections[0]!.aggregateId).toBe("agg-1");
        expect(repo.storedProjections[1]!.aggregateId).toBe("agg-2");
      });
    });

    describe("when entries list is empty", () => {
      it("skips store entirely", async () => {
        const repo = makeMockRepo();
        const batchSpy = vi.fn().mockResolvedValue(undefined);
        (repo as any).storeProjectionBatch = batchSpy;
        const store = new RepositoryFoldStore<TestData>(repo, "2026-03-01");

        await store.storeBatch([]);

        expect(batchSpy).not.toHaveBeenCalled();
        expect(repo.storeProjection).not.toHaveBeenCalled();
      });
    });
  });

  describe("get()", () => {
    it("returns data from projection when found", async () => {
      const repo = makeMockRepo();
      repo.getResult = {
        id: "agg-1",
        aggregateId: "agg-1",
        tenantId: "tenant-1" as TenantId,
        version: "2026-03-01",
        data: { total: 10, status: "done", CreatedAt: 1000, UpdatedAt: 2000 },
      };
      const store = new RepositoryFoldStore<TestData>(repo, "2026-03-01");

      const result = await store.get("agg-1", makeContext());
      expect(result).toEqual({
        total: 10,
        status: "done",
        CreatedAt: 1000,
        UpdatedAt: 2000,
      });
    });

    it("returns null when projection not found", async () => {
      const repo = makeMockRepo();
      repo.getResult = null;
      const store = new RepositoryFoldStore<TestData>(repo, "2026-03-01");

      const result = await store.get("agg-1", makeContext());
      expect(result).toBeNull();
    });

    it("passes tenantId to repository read context", async () => {
      const repo = makeMockRepo();
      repo.getResult = null;
      const store = new RepositoryFoldStore<TestData>(repo, "2026-03-01");

      await store.get("agg-1", makeContext({ tenantId: "tenant-99" as TenantId }));

      expect(repo.getProjection).toHaveBeenCalledWith(
        "agg-1",
        expect.objectContaining({ tenantId: "tenant-99" }),
      );
    });
  });
});
