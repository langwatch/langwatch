import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TenantId } from "../../domain/tenantId.ts";
import type { Projection } from "../../domain/types.ts";
import type { ProjectionStore } from "../../stores/projectionStore.types.ts";
import type { ProjectionStoreContext } from "../projectionStoreContext.ts";
import { RepositoryFoldStore } from "../repositoryFoldStore.ts";

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

function makeMockRepo() {
  const storedProjections: Projection<TestData>[] = [];
  const mock: {
    storedProjections: Projection<TestData>[];
    getResult: Projection<TestData> | null;
    storeProjection: ReturnType<typeof vi.fn<(projection: Projection<TestData>) => Promise<void>>>;
    findProjection: ReturnType<typeof vi.fn<() => Promise<Projection<TestData> | null>>>;
    storeProjectionBatch?: (projections: Projection<TestData>[]) => Promise<void>;
  } = {
    storedProjections,
    getResult: null,
    storeProjection: vi.fn(async (projection: Projection<TestData>) => {
      storedProjections.push(projection);
    }),
    findProjection: vi.fn(async () => mock.getResult),
  };
  return mock satisfies ProjectionStore<Projection<TestData>>;
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
      let repo: ReturnType<typeof makeMockRepo>;
      let batchSpy: ReturnType<
        typeof vi.fn<(projections: Projection<TestData>[]) => Promise<void>>
      >;
      let store: RepositoryFoldStore<TestData>;
      beforeEach(() => {
        repo = makeMockRepo();
        batchSpy = vi
          .fn<(projections: Projection<TestData>[]) => Promise<void>>()
          .mockResolvedValue(void 0);
        repo.storeProjectionBatch = batchSpy;
        store = new RepositoryFoldStore<TestData>(repo, "2026-03-01");
      });

      it("delegates to native batch insert with all entries", async () => {
        await store.storeBatch([
          {
            state: { total: 1, status: "a", CreatedAt: 100, UpdatedAt: 200 },
            context: makeContext({ aggregateId: "agg-1" }),
          },
          {
            state: { total: 2, status: "b", CreatedAt: 300, UpdatedAt: 400 },
            context: makeContext({ aggregateId: "agg-2" }),
          },
        ]);

        expect(batchSpy).toHaveBeenCalledOnce();
        const projections = batchSpy.mock.calls[0]![0];
        expect(projections).toHaveLength(2);
        expect(projections[0]?.aggregateId).toBe("agg-1");
        expect(projections[0]?.data.total).toBe(1);
        expect(projections[1]?.aggregateId).toBe("agg-2");
        expect(projections[1]?.data.total).toBe(2);
        // Individual store should NOT be called
        expect(repo.storeProjection).not.toHaveBeenCalled();
      });

      it("passes tenantId from first entry as write context", async () => {
        await store.storeBatch([
          {
            state: { total: 1, status: "a", CreatedAt: 100, UpdatedAt: 200 },
            context: makeContext({ tenantId: "proj_xyz" as TenantId }),
          },
        ]);

        expect(batchSpy).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ tenantId: "proj_xyz" }),
        );
      });

      it("passes the shared retentionPolicy as write metadata", async () => {
        const retentionPolicy = { traces: 49, scenarios: 63, experiments: 91 };

        await store.storeBatch([
          {
            state: { total: 1, status: "a", CreatedAt: 100, UpdatedAt: 200 },
            context: makeContext({ aggregateId: "agg-1", retentionPolicy }),
          },
          {
            state: { total: 2, status: "b", CreatedAt: 300, UpdatedAt: 400 },
            context: makeContext({ aggregateId: "agg-2", retentionPolicy }),
          },
        ]);

        expect(batchSpy).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ metadata: { retentionPolicy } }),
        );
        expect(repo.storeProjection).not.toHaveBeenCalled();
      });
    });

    describe("when batch context is not uniform", () => {
      let repo: ReturnType<typeof makeMockRepo>;
      let batchSpy: ReturnType<
        typeof vi.fn<(projections: Projection<TestData>[]) => Promise<void>>
      >;
      let store: RepositoryFoldStore<TestData>;
      beforeEach(() => {
        repo = makeMockRepo();
        batchSpy = vi
          .fn<(projections: Projection<TestData>[]) => Promise<void>>()
          .mockResolvedValue(void 0);
        repo.storeProjectionBatch = batchSpy;
        store = new RepositoryFoldStore<TestData>(repo, "2026-03-01");
      });

      it("falls back to per-entry writes for mixed tenantIds", async () => {
        await store.storeBatch([
          {
            state: { total: 1, status: "a", CreatedAt: 100, UpdatedAt: 200 },
            context: makeContext({
              aggregateId: "agg-1",
              tenantId: "tenant-1" as TenantId,
            }),
          },
          {
            state: { total: 2, status: "b", CreatedAt: 300, UpdatedAt: 400 },
            context: makeContext({
              aggregateId: "agg-2",
              tenantId: "tenant-2" as TenantId,
            }),
          },
        ]);

        // Native batch would stamp tenant-1 onto both rows — must not run.
        expect(batchSpy).not.toHaveBeenCalled();
        expect(repo.storeProjection).toHaveBeenCalledTimes(2);
        expect(repo.storedProjections[0]!.tenantId).toBe("tenant-1");
        expect(repo.storedProjections[1]!.tenantId).toBe("tenant-2");
      });

      it("falls back to per-entry writes for mixed retentionPolicies", async () => {
        await store.storeBatch([
          {
            state: { total: 1, status: "a", CreatedAt: 100, UpdatedAt: 200 },
            context: makeContext({
              aggregateId: "agg-1",
              retentionPolicy: { traces: 49, scenarios: 0, experiments: 0 },
            }),
          },
          {
            state: { total: 2, status: "b", CreatedAt: 300, UpdatedAt: 400 },
            context: makeContext({
              aggregateId: "agg-2",
              retentionPolicy: { traces: 91, scenarios: 0, experiments: 0 },
            }),
          },
        ]);

        expect(batchSpy).not.toHaveBeenCalled();
        expect(repo.storeProjection).toHaveBeenCalledTimes(2);
      });
    });

    describe("when repository does not support storeProjectionBatch", () => {
      it("falls back to sequential store calls", async () => {
        const repo = makeMockRepo();
        const store = new RepositoryFoldStore<TestData>(repo, "2026-03-01");

        await store.storeBatch([
          {
            state: { total: 1, status: "a", CreatedAt: 100, UpdatedAt: 200 },
            context: makeContext({ aggregateId: "agg-1" }),
          },
          {
            state: { total: 2, status: "b", CreatedAt: 300, UpdatedAt: 400 },
            context: makeContext({ aggregateId: "agg-2" }),
          },
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
        kind: "folded",
        state: {
          total: 10,
          status: "done",
          CreatedAt: 1000,
          UpdatedAt: 2000,
        },
      });
    });

    it("returns null when projection not found", async () => {
      const repo = makeMockRepo();
      repo.getResult = null;
      const store = new RepositoryFoldStore<TestData>(repo, "2026-03-01");

      const result = await store.get("agg-1", makeContext());
      expect(result).toEqual({ kind: "empty" });
    });

    it("passes tenantId to repository read context", async () => {
      const repo = makeMockRepo();
      repo.getResult = null;
      const store = new RepositoryFoldStore<TestData>(repo, "2026-03-01");

      await store.get("agg-1", makeContext({ tenantId: "tenant-99" as TenantId }));

      expect(repo.findProjection).toHaveBeenCalledWith(
        "agg-1",
        expect.objectContaining({ tenantId: "tenant-99" }),
      );
    });
  });
});
