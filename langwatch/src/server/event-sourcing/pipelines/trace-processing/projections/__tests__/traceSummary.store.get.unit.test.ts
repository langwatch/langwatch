import { describe, expect, it, vi } from "vitest";
import { TraceSummaryStore } from "../traceSummary.store";
import { createTenantId } from "../../../../domain/tenantId";
import type { ProjectionStoreContext } from "../../../../projections/projectionStoreContext";

function storeWithRepo() {
  const findByTraceId = vi.fn().mockResolvedValue(null);
  const store = new TraceSummaryStore({ findByTraceId } as any);
  return { store, findByTraceId };
}

describe("TraceSummaryStore.get", () => {
  const tenantId = createTenantId("project-1");

  describe("when the context carries occurredAtMs", () => {
    it("forwards it as the findByTraceId partition-prune hint", async () => {
      const { store, findByTraceId } = storeWithRepo();
      const context: ProjectionStoreContext = {
        aggregateId: "trace-1",
        tenantId,
        occurredAtMs: 1700000000000,
      };

      await store.get("trace-1", context);

      expect(findByTraceId).toHaveBeenCalledWith("project-1", "trace-1", {
        occurredAtMs: 1700000000000,
      });
    });
  });

  describe("when the context has no occurredAtMs", () => {
    it("reads without a hint (unbounded, still correct)", async () => {
      const { store, findByTraceId } = storeWithRepo();
      const context: ProjectionStoreContext = {
        aggregateId: "trace-1",
        tenantId,
      };

      await store.get("trace-1", context);

      expect(findByTraceId).toHaveBeenCalledWith(
        "project-1",
        "trace-1",
        undefined,
      );
    });
  });
});
