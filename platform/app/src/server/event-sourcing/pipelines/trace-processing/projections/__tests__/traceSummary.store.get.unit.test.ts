import type { ProjectionStoreContext } from "@langwatch/eventing";
import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it, vi } from "vitest";
import { TraceSummaryStore } from "../traceSummary.store";

function storeWithRepo() {
  const findByTraceId = vi.fn().mockResolvedValue(null);
  const store = new TraceSummaryStore({ findByTraceId } as any);
  return { store, findByTraceId };
}

describe("TraceSummaryStore.get", () => {
  const tenantId = createTenantId("project-1");

  describe("given the context carries the executor-computed readWindow", () => {
    it("forwards it verbatim as the findByTraceId window", async () => {
      const { store, findByTraceId } = storeWithRepo();
      const context: ProjectionStoreContext = {
        aggregateId: "trace-1",
        tenantId,
        occurredAtMs: 1700000000000,
        readWindow: { fromMs: 1699900000000, toMs: 1700100000000 },
      };

      await store.get("trace-1", context);

      expect(findByTraceId).toHaveBeenCalledWith("project-1", "trace-1", {
        window: { fromMs: 1699900000000, toMs: 1700100000000 },
      });
    });
  });

  describe("given the context has no readWindow", () => {
    it("reads without a bound (unbounded, still correct)", async () => {
      const { store, findByTraceId } = storeWithRepo();
      const context: ProjectionStoreContext = {
        aggregateId: "trace-1",
        tenantId,
      };

      await store.get("trace-1", context);

      expect(findByTraceId).toHaveBeenCalledWith("project-1", "trace-1", undefined);
    });

    it("does not derive a window from occurredAtMs on its own", async () => {
      const { store, findByTraceId } = storeWithRepo();
      const context: ProjectionStoreContext = {
        aggregateId: "trace-1",
        tenantId,
        occurredAtMs: 1700000000000,
      };

      await store.get("trace-1", context);

      expect(findByTraceId).toHaveBeenCalledWith("project-1", "trace-1", undefined);
    });
  });
});
