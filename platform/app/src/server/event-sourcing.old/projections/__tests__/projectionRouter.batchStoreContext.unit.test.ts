/**
 * @vitest-environment node
 *
 * The map-projection batch path used to resolve ONE store context from event 0
 * and spread it across the batch, re-deriving only `aggregateId` and
 * `tenantId`. That left `retentionPolicy` inherited — the field that decides
 * how long the written row survives — so a batch that ever spanned tenants
 * would stamp the first tenant's retention onto another tenant's rows, and the
 * mistake would outlive the batch that made it.
 */

import { describe, expect, it, vi } from "vitest";
import type { Event } from "../../domain/types";
import {
  createMockAppendStore,
  createMockMapProjectionDefinition,
  createMockQueueManager,
  createTestEvent,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../services/__tests__/testHelpers";
import type { QueueManager } from "../../services/queues/queueManager";
import { ProjectionRouter } from "../projectionRouter";

const TENANT_A = createTestTenantId("tenant-a");
const TENANT_B = createTestTenantId("tenant-b");

const RETENTION_BY_TENANT: Record<
  string,
  { traces: number; scenarios: number; experiments: number }
> = {
  "tenant-a": { traces: 7, scenarios: 7, experiments: 7 },
  "tenant-b": { traces: 365, scenarios: 365, experiments: 365 },
};

/**
 * Builds a router wired to a map projection and returns the batch callback the
 * queue manager was handed, so the batch path can be driven directly.
 */
function createBatchDriver() {
  let batchHandler:
    | ((
        handlerName: string,
        events: Event[],
        context: unknown,
      ) => Promise<void>)
    | undefined;

  const queueManager = createMockQueueManager();
  (
    queueManager.initializeHandlerQueues as ReturnType<typeof vi.fn>
  ).mockImplementation(
    (
      _defs: unknown,
      _single: unknown,
      batch: (
        handlerName: string,
        events: Event[],
        context: unknown,
      ) => Promise<void>,
    ) => {
      batchHandler = batch;
    },
  );

  const resolve = vi.fn(async (projectId: string) => {
    return RETENTION_BY_TENANT[projectId] ?? null;
  });

  const router = new ProjectionRouter(
    TEST_CONSTANTS.AGGREGATE_TYPE,
    TEST_CONSTANTS.PIPELINE_NAME,
    queueManager as unknown as QueueManager<Event>,
    undefined,
    undefined,
    { resolve } as never,
  );

  const store = createMockAppendStore<{ aggregateId: string }>();
  router.registerMapProjection(
    createMockMapProjectionDefinition("mapper", {
      store,
      map: (event: Event) => ({ aggregateId: String(event.aggregateId) }),
    }) as never,
  );
  router.initializeMapQueues();

  return {
    store,
    resolve,
    runBatch: async (events: Event[]) => {
      await batchHandler!("mapper", events, {});
    },
  };
}

describe("given a map-projection batch", () => {
  describe("when every event belongs to one tenant", () => {
    it("resolves that tenant's retention once for the whole batch", async () => {
      const { resolve, runBatch } = createBatchDriver();
      const events = ["one", "two", "three"].map((id) =>
        createTestEvent(id, TEST_CONSTANTS.AGGREGATE_TYPE, TENANT_A),
      );

      await runBatch(events);

      expect(resolve).toHaveBeenCalledTimes(1);
      expect(resolve).toHaveBeenCalledWith("tenant-a");
    });
  });

  describe("when the batch spans two tenants", () => {
    it("gives each event its own tenant's retention", async () => {
      const { store, runBatch } = createBatchDriver();
      const events = [
        createTestEvent("one", TEST_CONSTANTS.AGGREGATE_TYPE, TENANT_A),
        createTestEvent("two", TEST_CONSTANTS.AGGREGATE_TYPE, TENANT_B),
      ];

      await runBatch(events);

      const contexts = (
        store.append as ReturnType<typeof vi.fn>
      ).mock.calls.map((call) => call[1]);
      expect(contexts).toEqual([
        expect.objectContaining({
          tenantId: TENANT_A,
          retentionPolicy: RETENTION_BY_TENANT["tenant-a"],
        }),
        expect.objectContaining({
          tenantId: TENANT_B,
          retentionPolicy: RETENTION_BY_TENANT["tenant-b"],
        }),
      ]);
    });
  });
});
