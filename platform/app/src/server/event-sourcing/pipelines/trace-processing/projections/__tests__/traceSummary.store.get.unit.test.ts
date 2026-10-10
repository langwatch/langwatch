import type { Authorization } from "@langwatch/actor";
import { describe, expect, it, vi } from "vitest";
import type { TraceSummaryRepository } from "~/server/app-layer/traces/repositories/trace-summary.repository";
import { ownProof } from "~/test-utils/authorizationProofs";
import { createTenantId } from "../../../../domain/tenantId";
import type { ProjectionStoreContext } from "../../../../projections/projectionStoreContext";
import { TraceSummaryStore } from "../traceSummary.store";

const PROOF = ownProof({ projectId: "project-1" });

function storeWithRepo() {
  const findByTraceId = vi.fn().mockResolvedValue(null);
  const authorize = vi.fn(async (): Promise<Authorization> => PROOF);
  const store = new TraceSummaryStore({
    repository: { findByTraceId } as unknown as TraceSummaryRepository,
    authorize,
  });
  return { store, findByTraceId, authorize };
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

      expect(findByTraceId).toHaveBeenCalledWith({
        authorization: PROOF,
        traceId: "trace-1",
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

      expect(findByTraceId).toHaveBeenCalledWith({
        authorization: PROOF,
        traceId: "trace-1",
      });
    });

    it("does not derive a window from occurredAtMs on its own", async () => {
      const { store, findByTraceId } = storeWithRepo();
      const context: ProjectionStoreContext = {
        aggregateId: "trace-1",
        tenantId,
        occurredAtMs: 1700000000000,
      };

      await store.get("trace-1", context);

      expect(findByTraceId).toHaveBeenCalledWith({
        authorization: PROOF,
        traceId: "trace-1",
      });
    });
  });

  describe("given the read is fenced by a proof", () => {
    describe("when the executor named the event being folded", () => {
      it("mints an own proof on the context's tenant for that event", async () => {
        const { store, authorize } = storeWithRepo();

        await store.get("trace-1", {
          aggregateId: "trace-1",
          tenantId,
          eventId: "evt-1",
        });

        expect(authorize).toHaveBeenCalledWith({
          projectId: "project-1",
          purpose: { kind: "event", eventId: "evt-1" },
        });
      });
    });

    describe("when the read is made outside a fold step", () => {
      it("names the store's read as the purpose", async () => {
        const { store, authorize } = storeWithRepo();

        await store.get("trace-1", { aggregateId: "trace-1", tenantId });

        expect(authorize).toHaveBeenCalledWith({
          projectId: "project-1",
          purpose: { kind: "operator", entry: "TraceSummaryStore.get" },
        });
      });
    });
  });
});
