import { describe, it, expect } from "vitest";
import { EventStoreMemory } from "../eventStoreMemory";
import { CheckpointRepositoryMemory } from "../checkpointRepositoryMemory";
import type { Event } from "../../library";
import type { BulkRebuildCheckpoint } from "../../library";

describe("Tenant Isolation", () => {
  describe("EventStoreMemory", () => {
    const store = new EventStoreMemory<string, Event<string>>();
    const aggregateType = "trace" as const;

    it("isolates events by tenant", async () => {
      const tenant1 = "tenant-1";
      const tenant2 = "tenant-2";
      const aggregateId = "agg-1";

      const event1: Event<string> = {
        aggregateId,
        timestamp: 1000,
        type: "TEST" as any,
        data: { value: "tenant1" },
      };

      const event2: Event<string> = {
        aggregateId,
        timestamp: 1000,
        type: "TEST" as any,
        data: { value: "tenant2" },
      };

      // Store events for different tenants
      await store.storeEvents([event1], { tenantId: tenant1 }, aggregateType);
      await store.storeEvents([event2], { tenantId: tenant2 }, aggregateType);

      // Retrieve events for each tenant
      const tenant1Events = await store.getEvents(
        aggregateId,
        { tenantId: tenant1 },
        aggregateType,
      );
      const tenant2Events = await store.getEvents(
        aggregateId,
        { tenantId: tenant2 },
        aggregateType,
      );

      // Each tenant should only see their own events
      expect(tenant1Events).toHaveLength(1);
      expect(tenant1Events[0]?.data).toEqual({ value: "tenant1" });
      expect(tenant2Events).toHaveLength(1);
      expect(tenant2Events[0]?.data).toEqual({ value: "tenant2" });
    });

    it("rejects operations without tenantId", async () => {
      const event: Event<string> = {
        aggregateId: "agg-1",
        timestamp: 1000,
        type: "TEST" as any,
        data: {},
      };

      await expect(
        store.storeEvents([event], {} as any, aggregateType),
      ).rejects.toThrow("[SECURITY]");

      await expect(
        store.getEvents("agg-1", {} as any, aggregateType),
      ).rejects.toThrow("[SECURITY]");
    });

    it("rejects operations with empty tenantId", async () => {
      const event: Event<string> = {
        aggregateId: "agg-1",
        timestamp: 1000,
        type: "TEST" as any,
        data: {},
      };

      await expect(
        store.storeEvents([event], { tenantId: "" }, aggregateType),
      ).rejects.toThrow("[SECURITY]");

      await expect(
        store.getEvents("agg-1", { tenantId: "" }, aggregateType),
      ).rejects.toThrow("[SECURITY]");
    });

    it("isolates aggregate lists by tenant", async () => {
      // Use a fresh store instance to avoid state from previous tests
      const freshStore = new EventStoreMemory<string, Event<string>>();
      const tenant1 = "tenant-1";
      const tenant2 = "tenant-2";

      const event1: Event<string> = {
        aggregateId: "agg-1",
        timestamp: 1000,
        type: "TEST" as any,
        data: {},
      };

      const event2: Event<string> = {
        aggregateId: "agg-2",
        timestamp: 1000,
        type: "TEST" as any,
        data: {},
      };

      await freshStore.storeEvents(
        [event1],
        { tenantId: tenant1 },
        aggregateType,
      );
      await freshStore.storeEvents(
        [event2],
        { tenantId: tenant2 },
        aggregateType,
      );

      const tenant1Aggregates = await freshStore.listAggregateIds(
        { tenantId: tenant1 },
        aggregateType,
      );
      const tenant2Aggregates = await freshStore.listAggregateIds(
        { tenantId: tenant2 },
        aggregateType,
      );

      expect(tenant1Aggregates.aggregateIds).toEqual(["agg-1"]);
      expect(tenant2Aggregates.aggregateIds).toEqual(["agg-2"]);
    });
  });

  describe("CheckpointRepositoryMemory", () => {
    const repo = new CheckpointRepositoryMemory();
    const aggregateType = "trace";

    it("isolates checkpoints by tenant", async () => {
      const tenant1 = "tenant-1";
      const tenant2 = "tenant-2";

      const checkpoint1: BulkRebuildCheckpoint<string> = {
        processedCount: 10,
        lastAggregateId: "agg-1",
      };

      const checkpoint2: BulkRebuildCheckpoint<string> = {
        processedCount: 20,
        lastAggregateId: "agg-2",
      };

      await repo.saveCheckpoint(tenant1, aggregateType, checkpoint1);
      await repo.saveCheckpoint(tenant2, aggregateType, checkpoint2);

      const loaded1 = await repo.loadCheckpoint(tenant1, aggregateType);
      const loaded2 = await repo.loadCheckpoint(tenant2, aggregateType);

      expect(loaded1?.processedCount).toBe(10);
      expect(loaded1?.lastAggregateId).toBe("agg-1");
      expect(loaded2?.processedCount).toBe(20);
      expect(loaded2?.lastAggregateId).toBe("agg-2");
    });

    it("rejects operations without tenantId", async () => {
      const checkpoint: BulkRebuildCheckpoint<string> = {
        processedCount: 10,
      };

      await expect(
        repo.saveCheckpoint("" as any, aggregateType, checkpoint),
      ).rejects.toThrow("[SECURITY]");

      await expect(
        repo.loadCheckpoint("" as any, aggregateType),
      ).rejects.toThrow("[SECURITY]");

      await expect(
        repo.clearCheckpoint("" as any, aggregateType),
      ).rejects.toThrow("[SECURITY]");
    });

    it("rejects operations with empty tenantId", async () => {
      const checkpoint: BulkRebuildCheckpoint<string> = {
        processedCount: 10,
      };

      await expect(
        repo.saveCheckpoint("", aggregateType, checkpoint),
      ).rejects.toThrow("[SECURITY]");

      await expect(repo.loadCheckpoint("", aggregateType)).rejects.toThrow(
        "[SECURITY]",
      );

      await expect(repo.clearCheckpoint("", aggregateType)).rejects.toThrow(
        "[SECURITY]",
      );
    });
  });
});
