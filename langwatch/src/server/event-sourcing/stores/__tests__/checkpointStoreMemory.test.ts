import { describe, it, expect, beforeEach } from "vitest";
import { CheckpointStoreMemory } from "../checkpointStoreMemory";
import type { BulkRebuildCheckpoint } from "../../library";

describe("CheckpointStoreMemory", () => {
  let repo: CheckpointStoreMemory;
  const tenantId = "test-tenant";
  const aggregateType = "trace";

  beforeEach(() => {
    repo = new CheckpointStoreMemory();
  });

  describe("saveCheckpoint()", () => {
    it("saves checkpoint correctly", async () => {
      const checkpoint: BulkRebuildCheckpoint<string> = {
        cursor: "cursor-1",
        lastAggregateId: "agg-1",
        processedCount: 100,
      };

      await repo.saveCheckpoint(tenantId, aggregateType, checkpoint);
      const loaded = await repo.loadCheckpoint(tenantId, aggregateType);

      expect(loaded).not.toBeNull();
      expect(loaded?.cursor).toBe("cursor-1");
      expect(loaded?.lastAggregateId).toBe("agg-1");
      expect(loaded?.processedCount).toBe(100);
    });

    it("overwrites existing checkpoint", async () => {
      const checkpoint1: BulkRebuildCheckpoint<string> = {
        cursor: "cursor-1",
        lastAggregateId: "agg-1",
        processedCount: 100,
      };

      const checkpoint2: BulkRebuildCheckpoint<string> = {
        cursor: "cursor-2",
        lastAggregateId: "agg-2",
        processedCount: 200,
      };

      await repo.saveCheckpoint(tenantId, aggregateType, checkpoint1);
      await repo.saveCheckpoint(tenantId, aggregateType, checkpoint2);

      const loaded = await repo.loadCheckpoint(tenantId, aggregateType);

      expect(loaded?.cursor).toBe("cursor-2");
      expect(loaded?.lastAggregateId).toBe("agg-2");
      expect(loaded?.processedCount).toBe(200);
    });

    it("handles empty string cursor", async () => {
      const checkpoint: BulkRebuildCheckpoint<string> = {
        cursor: "",
        lastAggregateId: "agg-1",
        processedCount: 100,
      };

      await repo.saveCheckpoint(tenantId, aggregateType, checkpoint);
      const loaded = await repo.loadCheckpoint(tenantId, aggregateType);

      expect(loaded?.cursor).toBe("");
    });

    it("handles undefined cursor", async () => {
      const checkpoint: BulkRebuildCheckpoint<string> = {
        cursor: undefined,
        lastAggregateId: "agg-1",
        processedCount: 100,
      };

      await repo.saveCheckpoint(tenantId, aggregateType, checkpoint);
      const loaded = await repo.loadCheckpoint(tenantId, aggregateType);

      expect(loaded?.cursor).toBeUndefined();
    });

    it("handles empty string lastAggregateId", async () => {
      const checkpoint: BulkRebuildCheckpoint<string> = {
        cursor: "cursor-1",
        lastAggregateId: "",
        processedCount: 100,
      };

      await repo.saveCheckpoint(tenantId, aggregateType, checkpoint);
      const loaded = await repo.loadCheckpoint(tenantId, aggregateType);

      expect(loaded?.lastAggregateId).toBe("");
    });

    it("handles undefined lastAggregateId", async () => {
      const checkpoint: BulkRebuildCheckpoint<string> = {
        cursor: "cursor-1",
        lastAggregateId: undefined,
        processedCount: 100,
      };

      await repo.saveCheckpoint(tenantId, aggregateType, checkpoint);
      const loaded = await repo.loadCheckpoint(tenantId, aggregateType);

      expect(loaded?.lastAggregateId).toBeUndefined();
    });

    it("processedCount of 0 is valid", async () => {
      const checkpoint: BulkRebuildCheckpoint<string> = {
        processedCount: 0,
      };

      await repo.saveCheckpoint(tenantId, aggregateType, checkpoint);
      const loaded = await repo.loadCheckpoint(tenantId, aggregateType);

      expect(loaded?.processedCount).toBe(0);
    });

    it("prevents mutation of stored checkpoint from input", async () => {
      const checkpoint: BulkRebuildCheckpoint<string> = {
        cursor: "cursor-1",
        lastAggregateId: "agg-1",
        processedCount: 100,
      };

      await repo.saveCheckpoint(tenantId, aggregateType, checkpoint);

      // Mutate original checkpoint
      checkpoint.cursor = "mutated";
      checkpoint.processedCount = 999;

      // Loaded checkpoint should be unchanged
      const loaded = await repo.loadCheckpoint(tenantId, aggregateType);
      expect(loaded?.cursor).toBe("cursor-1");
      expect(loaded?.processedCount).toBe(100);
    });
  });

  describe("loadCheckpoint()", () => {
    it("loads existing checkpoint", async () => {
      const checkpoint: BulkRebuildCheckpoint<string> = {
        cursor: "cursor-1",
        lastAggregateId: "agg-1",
        processedCount: 100,
      };

      await repo.saveCheckpoint(tenantId, aggregateType, checkpoint);
      const loaded = await repo.loadCheckpoint(tenantId, aggregateType);

      expect(loaded).not.toBeNull();
      expect(loaded?.cursor).toBe("cursor-1");
      expect(loaded?.lastAggregateId).toBe("agg-1");
      expect(loaded?.processedCount).toBe(100);
    });

    it("returns null when no checkpoint exists", async () => {
      const loaded = await repo.loadCheckpoint(tenantId, aggregateType);

      expect(loaded).toBeNull();
    });

    it("returns exact checkpoint object (not modified)", async () => {
      const checkpoint: BulkRebuildCheckpoint<string> = {
        cursor: "cursor-1",
        lastAggregateId: "agg-1",
        processedCount: 100,
      };

      await repo.saveCheckpoint(tenantId, aggregateType, checkpoint);
      const loaded = await repo.loadCheckpoint(tenantId, aggregateType);

      expect(loaded).toEqual(checkpoint);
    });

    it("returns new object (not reference to internal storage)", async () => {
      const checkpoint: BulkRebuildCheckpoint<string> = {
        processedCount: 100,
      };

      await repo.saveCheckpoint(tenantId, aggregateType, checkpoint);
      const loaded1 = await repo.loadCheckpoint(tenantId, aggregateType);
      const loaded2 = await repo.loadCheckpoint(tenantId, aggregateType);

      // Should return different object instances
      expect(loaded1).not.toBe(loaded2);
      expect(loaded1).toEqual(loaded2);
    });

    it("prevents mutation of loaded checkpoint affecting stored checkpoint", async () => {
      const checkpoint: BulkRebuildCheckpoint<string> = {
        cursor: "cursor-1",
        processedCount: 100,
      };

      await repo.saveCheckpoint(tenantId, aggregateType, checkpoint);
      const loaded = await repo.loadCheckpoint(tenantId, aggregateType);

      // Mutate loaded checkpoint
      if (loaded) {
        loaded.cursor = "mutated";
        loaded.processedCount = 999;
      }

      // Reload - should be unchanged
      const reloaded = await repo.loadCheckpoint(tenantId, aggregateType);
      expect(reloaded?.cursor).toBe("cursor-1");
      expect(reloaded?.processedCount).toBe(100);
    });
  });

  describe("clearCheckpoint()", () => {
    it("deletes checkpoint completely", async () => {
      const checkpoint: BulkRebuildCheckpoint<string> = {
        processedCount: 100,
      };

      await repo.saveCheckpoint(tenantId, aggregateType, checkpoint);
      await repo.clearCheckpoint(tenantId, aggregateType);

      const loaded = await repo.loadCheckpoint(tenantId, aggregateType);
      expect(loaded).toBeNull();
    });

    it("clear then load returns null (not reset checkpoint)", async () => {
      const checkpoint: BulkRebuildCheckpoint<string> = {
        processedCount: 100,
      };

      await repo.saveCheckpoint(tenantId, aggregateType, checkpoint);
      await repo.clearCheckpoint(tenantId, aggregateType);

      const loaded = await repo.loadCheckpoint(tenantId, aggregateType);
      expect(loaded).toBeNull();
    });

    it("clearing non-existent checkpoint is no-op", async () => {
      await expect(
        repo.clearCheckpoint(tenantId, aggregateType),
      ).resolves.not.toThrow();

      const loaded = await repo.loadCheckpoint(tenantId, aggregateType);
      expect(loaded).toBeNull();
    });

    it("multiple clears are idempotent", async () => {
      const checkpoint: BulkRebuildCheckpoint<string> = {
        processedCount: 100,
      };

      await repo.saveCheckpoint(tenantId, aggregateType, checkpoint);
      await repo.clearCheckpoint(tenantId, aggregateType);
      await repo.clearCheckpoint(tenantId, aggregateType);
      await repo.clearCheckpoint(tenantId, aggregateType);

      const loaded = await repo.loadCheckpoint(tenantId, aggregateType);
      expect(loaded).toBeNull();
    });
  });

  describe("tenant isolation", () => {
    it("saves checkpoints isolated by tenant", async () => {
      const checkpoint1: BulkRebuildCheckpoint<string> = {
        processedCount: 100,
      };
      const checkpoint2: BulkRebuildCheckpoint<string> = {
        processedCount: 200,
      };

      await repo.saveCheckpoint("tenant-1", aggregateType, checkpoint1);
      await repo.saveCheckpoint("tenant-2", aggregateType, checkpoint2);

      const loaded1 = await repo.loadCheckpoint("tenant-1", aggregateType);
      const loaded2 = await repo.loadCheckpoint("tenant-2", aggregateType);

      expect(loaded1?.processedCount).toBe(100);
      expect(loaded2?.processedCount).toBe(200);
    });

    it("clears checkpoints isolated by tenant", async () => {
      const checkpoint: BulkRebuildCheckpoint<string> = {
        processedCount: 100,
      };

      await repo.saveCheckpoint("tenant-1", aggregateType, checkpoint);
      await repo.saveCheckpoint("tenant-2", aggregateType, checkpoint);

      await repo.clearCheckpoint("tenant-1", aggregateType);

      const loaded1 = await repo.loadCheckpoint("tenant-1", aggregateType);
      const loaded2 = await repo.loadCheckpoint("tenant-2", aggregateType);

      expect(loaded1).toBeNull();
      expect(loaded2?.processedCount).toBe(100);
    });
  });

  describe("aggregate type isolation", () => {
    it("saves checkpoints isolated by aggregateType", async () => {
      const checkpoint: BulkRebuildCheckpoint<string> = {
        processedCount: 100,
      };

      await repo.saveCheckpoint(tenantId, "trace", checkpoint);
      await repo.saveCheckpoint(tenantId, "user", checkpoint);

      const traceCheckpoint = await repo.loadCheckpoint(tenantId, "trace");
      const userCheckpoint = await repo.loadCheckpoint(tenantId, "user");

      expect(traceCheckpoint?.processedCount).toBe(100);
      expect(userCheckpoint?.processedCount).toBe(100);
      expect(traceCheckpoint).not.toBe(userCheckpoint);
    });

    it("clears checkpoints isolated by aggregateType", async () => {
      const checkpoint: BulkRebuildCheckpoint<string> = {
        processedCount: 100,
      };

      await repo.saveCheckpoint(tenantId, "trace", checkpoint);
      await repo.saveCheckpoint(tenantId, "user", checkpoint);

      await repo.clearCheckpoint(tenantId, "trace");

      const traceCheckpoint = await repo.loadCheckpoint(tenantId, "trace");
      const userCheckpoint = await repo.loadCheckpoint(tenantId, "user");

      expect(traceCheckpoint).toBeNull();
      expect(userCheckpoint?.processedCount).toBe(100);
    });
  });
});
