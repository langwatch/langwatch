import { describe, expect, it } from "vitest";

import { createTenantId } from "../../domain/tenantId.ts";
import { EventUtils } from "../../index.ts";
import {
  createMockEventStore,
  createMockFoldProjectionDefinition,
  TEST_EVENT_TYPES,
} from "../../services/__tests__/testHelpers.ts";
import { EventStoreMemory } from "../../stores/eventStoreMemory.ts";
import { wireFoldEventLoaders } from "../eventLogLoaders.ts";

describe("wireFoldEventLoaders event-log probe", () => {
  const tenantId = createTenantId("test-tenant");

  describe("given an event log that can be probed", () => {
    it("wires a probe over the fold's own aggregate type", async () => {
      const eventStore = EventStoreMemory.createForTesting();
      const first = EventUtils.createEvent({
        aggregateType: "trace",
        aggregateId: "trace-1",
        tenantId,
        type: TEST_EVENT_TYPES[0],
        version: "2025-12-17",
        data: {},
        createdAt: 1000,
      });
      await eventStore.storeEvents([first], { tenantId }, "trace");
      const fold = createMockFoldProjectionDefinition("probed");

      wireFoldEventLoaders({ fold, log: { aggregateType: "trace", eventStore } });
      const probe = await fold.eventLogProbe?.({
        tenantId,
        aggregateId: "trace-1",
        event: first,
      });

      expect(probe).toEqual({ hasEvent: true, hasEarlierEvents: false });
    });
  });

  describe("given an event log with no probe", () => {
    it("leaves the fold without one, so a store miss keeps re-folding", () => {
      const fold = createMockFoldProjectionDefinition("unprobed");

      wireFoldEventLoaders({
        fold,
        log: { aggregateType: "trace", eventStore: createMockEventStore() },
      });

      expect(fold.eventLogProbe).toBeUndefined();
    });
  });
});
