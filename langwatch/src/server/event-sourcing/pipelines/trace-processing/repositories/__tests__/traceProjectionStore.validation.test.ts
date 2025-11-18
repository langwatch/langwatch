import { describe, it, expect, vi, beforeEach } from "vitest";
import { TraceProjectionRepositoryMemory } from "../traceProjectionRepositoryMemory";
import { TraceProjectionRepositoryClickHouse } from "../traceProjectionRepositoryClickHouse";
import type { TraceProjection } from "../../types";
import { createTenantId } from "../../../../library";

describe("TraceProjectionRepository - Validation", () => {
  describe("TraceProjectionRepositoryMemory", () => {
    const store = new TraceProjectionRepositoryMemory();
    const tenantId = createTenantId("test-tenant");
    const context = { tenantId };

    describe("getProjection", () => {
      it("rejects operations without tenantId", async () => {
        await expect(store.getProjection("trace-1", {} as any)).rejects.toThrow(
          "[SECURITY]",
        );
      });

      it("rejects operations with empty tenantId", async () => {
        await expect(
          store.getProjection("trace-1", { tenantId: "" } as any),
        ).rejects.toThrow("[SECURITY]");
      });
    });

    describe("storeProjection", () => {
      it("rejects operations without tenantId in context", async () => {
        const projection: TraceProjection = {
          id: "proj-1",
          aggregateId: "trace-1",
          tenantId,
          version: Date.now(),
          data: {
            tenantId: String(tenantId),
            traceId: "trace-1",
            spanCount: 0,
            containsErrorStatus: false,
            containsOKStatus: false,
            totalDurationMs: 100,
            createdAt: Date.now(),
            lastUpdatedAt: Date.now(),
          },
        };

        await expect(
          store.storeProjection(projection, {} as any),
        ).rejects.toThrow("[SECURITY]");
      });

      it("rejects operations with empty tenantId in context", async () => {
        const projection: TraceProjection = {
          id: "proj-1",
          aggregateId: "trace-1",
          tenantId,
          version: Date.now(),
          data: {
            tenantId: String(tenantId),
            traceId: "trace-1",
            spanCount: 0,
            containsErrorStatus: false,
            containsOKStatus: false,
            totalDurationMs: 100,
            createdAt: Date.now(),
            lastUpdatedAt: Date.now(),
          },
        };

        await expect(
          store.storeProjection(projection, { tenantId: "" } as any),
        ).rejects.toThrow("[SECURITY]");
      });

      it("rejects projections with missing tenantId", async () => {
        const projection = {
          id: "proj-1",
          aggregateId: "trace-1",
          version: Date.now(),
          data: {
            tenantId: String(tenantId),
            traceId: "trace-1",
            spanCount: 0,
            containsErrorStatus: false,
            containsOKStatus: false,
            totalDurationMs: 100,
            createdAt: Date.now(),
            lastUpdatedAt: Date.now(),
          },
        } as any;

        // Validation happens before security check, so we get validation error
        await expect(
          store.storeProjection(projection, context),
        ).rejects.toThrow(/\[(VALIDATION|SECURITY)\]/);
      });

      it("rejects projections with tenantId mismatch", async () => {
        const projection: TraceProjection = {
          id: "proj-1",
          aggregateId: "trace-1",
          tenantId: createTenantId("different-tenant"),
          version: Date.now(),
          data: {
            tenantId: "different-tenant",
            traceId: "trace-1",
            spanCount: 0,
            containsErrorStatus: false,
            containsOKStatus: false,
            totalDurationMs: 100,
            createdAt: Date.now(),
            lastUpdatedAt: Date.now(),
          },
        };

        await expect(
          store.storeProjection(projection, context),
        ).rejects.toThrow(
          "[SECURITY] Projection has tenantId 'different-tenant' that does not match context tenantId",
        );
      });

      it("accepts valid projections with matching tenantId", async () => {
        const projection: TraceProjection = {
          id: "proj-1",
          aggregateId: "trace-1",
          tenantId,
          version: Date.now(),
          data: {
            tenantId: String(tenantId),
            traceId: "trace-1",
            spanCount: 0,
            containsErrorStatus: false,
            containsOKStatus: false,
            totalDurationMs: 100,
            createdAt: Date.now(),
            lastUpdatedAt: Date.now(),
          },
        };

        await expect(
          store.storeProjection(projection, context),
        ).resolves.not.toThrow();
      });
    });
  });

  describe("TraceProjectionRepositoryClickHouse", () => {
    let mockClickHouseClient: any;
    let store: TraceProjectionRepositoryClickHouse;

    beforeEach(() => {
      mockClickHouseClient = {
        query: vi.fn().mockResolvedValue({
          json: async () => [],
        }),
        insert: vi.fn().mockResolvedValue(void 0),
      };
      store = new TraceProjectionRepositoryClickHouse(mockClickHouseClient);
    });

    const tenantId = createTenantId("test-tenant");
    const context = { tenantId };

    describe("getProjection", () => {
      it("rejects operations without tenantId", async () => {
        await expect(store.getProjection("trace-1", {} as any)).rejects.toThrow(
          "[SECURITY]",
        );

        expect(mockClickHouseClient.query).not.toHaveBeenCalled();
      });

      it("rejects operations with empty tenantId", async () => {
        await expect(
          store.getProjection("trace-1", { tenantId: "" } as any),
        ).rejects.toThrow("[SECURITY]");

        expect(mockClickHouseClient.query).not.toHaveBeenCalled();
      });
    });

    describe("storeProjection", () => {
      it("rejects operations without tenantId in context", async () => {
        const projection: TraceProjection = {
          id: "proj-1",
          aggregateId: "trace-1",
          tenantId,
          version: Date.now(),
          data: {
            tenantId: String(tenantId),
            traceId: "trace-1",
            spanCount: 0,
            containsErrorStatus: false,
            containsOKStatus: false,
            totalDurationMs: 100,
            createdAt: Date.now(),
            lastUpdatedAt: Date.now(),
          },
        };

        await expect(
          store.storeProjection(projection, {} as any),
        ).rejects.toThrow("[SECURITY]");

        expect(mockClickHouseClient.insert).not.toHaveBeenCalled();
      });

      it("rejects operations with empty tenantId in context", async () => {
        const projection: TraceProjection = {
          id: "proj-1",
          aggregateId: "trace-1",
          tenantId,
          version: Date.now(),
          data: {
            tenantId: String(tenantId),
            traceId: "trace-1",
            spanCount: 0,
            containsErrorStatus: false,
            containsOKStatus: false,
            totalDurationMs: 100,
            createdAt: Date.now(),
            lastUpdatedAt: Date.now(),
          },
        };

        await expect(
          store.storeProjection(projection, { tenantId: "" } as any),
        ).rejects.toThrow("[SECURITY]");

        expect(mockClickHouseClient.insert).not.toHaveBeenCalled();
      });

      it("rejects projections with missing tenantId", async () => {
        const projection = {
          id: "proj-1",
          aggregateId: "trace-1",
          version: Date.now(),
          data: {
            tenantId: String(tenantId),
            traceId: "trace-1",
            spanCount: 0,
            containsErrorStatus: false,
            containsOKStatus: false,
            totalDurationMs: 100,
            createdAt: Date.now(),
            lastUpdatedAt: Date.now(),
          },
        } as any;

        // Validation happens before security check, so we get validation error
        await expect(
          store.storeProjection(projection, context),
        ).rejects.toThrow(/\[(VALIDATION|SECURITY)\]/);

        expect(mockClickHouseClient.insert).not.toHaveBeenCalled();
      });

      it("rejects projections with tenantId mismatch", async () => {
        const projection: TraceProjection = {
          id: "proj-1",
          aggregateId: "trace-1",
          tenantId: createTenantId("different-tenant"),
          version: Date.now(),
          data: {
            tenantId: "different-tenant",
            traceId: "trace-1",
            spanCount: 0,
            containsErrorStatus: false,
            containsOKStatus: false,
            totalDurationMs: 100,
            createdAt: Date.now(),
            lastUpdatedAt: Date.now(),
          },
        };

        await expect(
          store.storeProjection(projection, context),
        ).rejects.toThrow(
          "[SECURITY] Projection has tenantId 'different-tenant' that does not match context tenantId",
        );

        expect(mockClickHouseClient.insert).not.toHaveBeenCalled();
      });

      it("accepts valid projections with matching tenantId", async () => {
        const projection: TraceProjection = {
          id: "proj-1",
          aggregateId: "trace-1",
          tenantId,
          version: Date.now(),
          data: {
            tenantId: String(tenantId),
            traceId: "trace-1",
            spanCount: 0,
            containsErrorStatus: false,
            containsOKStatus: false,
            totalDurationMs: 100,
            createdAt: Date.now(),
            lastUpdatedAt: Date.now(),
          },
        };

        await store.storeProjection(projection, context);

        expect(mockClickHouseClient.insert).toHaveBeenCalled();
      });
    });
  });
});
