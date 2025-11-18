import { describe, it, expect, vi, beforeEach } from "vitest";
import { CheckpointStoreClickHouse } from "../checkpointStoreClickHouse";
import type { BulkRebuildCheckpoint } from "../../library";
import type { ClickHouseClient } from "@clickhouse/client";

describe("CheckpointStoreClickHouse", () => {
  let mockClickHouseClient: any;
  let repo: CheckpointStoreClickHouse;
  const tenantId = "test-tenant";
  const aggregateType = "trace";

  beforeEach(() => {
    mockClickHouseClient = {
      insert: vi.fn().mockResolvedValue(void 0),
      query: vi.fn(),
    };
    repo = new CheckpointStoreClickHouse(mockClickHouseClient);
  });

  describe("saveCheckpoint()", () => {
    it("saves checkpoint with all fields", async () => {
      const checkpoint: BulkRebuildCheckpoint<string> = {
        cursor: "cursor-1",
        lastAggregateId: "agg-1",
        processedCount: 100,
      };

      await repo.saveCheckpoint(tenantId, aggregateType, checkpoint);

      expect(mockClickHouseClient.insert).toHaveBeenCalled();
      const insertCall = mockClickHouseClient.insert.mock.calls[0];
      expect(insertCall[0].table).toBe("event_log_checkpoints");
      expect(insertCall[0].values[0].TenantId).toBe(tenantId);
      expect(insertCall[0].values[0].AggregateType).toBe(aggregateType);
      expect(insertCall[0].values[0].Cursor).toBe("cursor-1");
      expect(insertCall[0].values[0].LastAggregateId).toBe("agg-1");
      expect(insertCall[0].values[0].ProcessedCount).toBe(100);
      expect(insertCall[0].values[0].UpdatedAt).toBeDefined();
    });

    it("saves checkpoint with optional fields (cursor, lastAggregateId)", async () => {
      const checkpoint: BulkRebuildCheckpoint<string> = {
        processedCount: 50,
      };

      await repo.saveCheckpoint(tenantId, aggregateType, checkpoint);

      const insertCall = mockClickHouseClient.insert.mock.calls[0];
      expect(insertCall[0].values[0].Cursor).toBe("");
      expect(insertCall[0].values[0].LastAggregateId).toBe("");
      expect(insertCall[0].values[0].ProcessedCount).toBe(50);
    });

    it("handles empty string cursor", async () => {
      const checkpoint: BulkRebuildCheckpoint<string> = {
        cursor: "",
        lastAggregateId: "agg-1",
        processedCount: 100,
      };

      await repo.saveCheckpoint(tenantId, aggregateType, checkpoint);

      const insertCall = mockClickHouseClient.insert.mock.calls[0];
      expect(insertCall[0].values[0].Cursor).toBe("");
    });

    it("handles undefined cursor as empty string", async () => {
      const checkpoint: BulkRebuildCheckpoint<string> = {
        cursor: undefined,
        lastAggregateId: "agg-1",
        processedCount: 100,
      };

      await repo.saveCheckpoint(tenantId, aggregateType, checkpoint);

      const insertCall = mockClickHouseClient.insert.mock.calls[0];
      expect(insertCall[0].values[0].Cursor).toBe("");
    });

    it("handles empty string lastAggregateId", async () => {
      const checkpoint: BulkRebuildCheckpoint<string> = {
        cursor: "cursor-1",
        lastAggregateId: "",
        processedCount: 100,
      };

      await repo.saveCheckpoint(tenantId, aggregateType, checkpoint);

      const insertCall = mockClickHouseClient.insert.mock.calls[0];
      expect(insertCall[0].values[0].LastAggregateId).toBe("");
    });

    it("handles undefined lastAggregateId as empty string", async () => {
      const checkpoint: BulkRebuildCheckpoint<string> = {
        cursor: "cursor-1",
        lastAggregateId: undefined,
        processedCount: 100,
      };

      await repo.saveCheckpoint(tenantId, aggregateType, checkpoint);

      const insertCall = mockClickHouseClient.insert.mock.calls[0];
      expect(insertCall[0].values[0].LastAggregateId).toBe("");
    });

    it("processedCount of 0 is valid", async () => {
      const checkpoint: BulkRebuildCheckpoint<string> = {
        processedCount: 0,
      };

      await repo.saveCheckpoint(tenantId, aggregateType, checkpoint);

      const insertCall = mockClickHouseClient.insert.mock.calls[0];
      expect(insertCall[0].values[0].ProcessedCount).toBe(0);
    });

    it("handles very large processedCount", async () => {
      const checkpoint: BulkRebuildCheckpoint<string> = {
        processedCount: Number.MAX_SAFE_INTEGER,
      };

      await repo.saveCheckpoint(tenantId, aggregateType, checkpoint);

      const insertCall = mockClickHouseClient.insert.mock.calls[0];
      expect(insertCall[0].values[0].ProcessedCount).toBe(
        Number.MAX_SAFE_INTEGER,
      );
    });

    it("sets UpdatedAt to current timestamp", async () => {
      const beforeTime = Date.now();
      const checkpoint: BulkRebuildCheckpoint<string> = {
        processedCount: 100,
      };

      await repo.saveCheckpoint(tenantId, aggregateType, checkpoint);
      const afterTime = Date.now();

      const insertCall = mockClickHouseClient.insert.mock.calls[0];
      const updatedAt = insertCall[0].values[0].UpdatedAt;
      expect(updatedAt).toBeGreaterThanOrEqual(beforeTime);
      expect(updatedAt).toBeLessThanOrEqual(afterTime);
    });

    it("handles error and logs correctly", async () => {
      const error = new Error("Insert failed");
      mockClickHouseClient.insert.mockRejectedValue(error);

      const checkpoint: BulkRebuildCheckpoint<string> = {
        processedCount: 100,
      };

      await expect(
        repo.saveCheckpoint(tenantId, aggregateType, checkpoint),
      ).rejects.toThrow("Insert failed");
    });
  });

  describe("loadCheckpoint()", () => {
    it("loads existing checkpoint", async () => {
      const mockRows = [
        {
          Cursor: "cursor-1",
          LastAggregateId: "agg-1",
          ProcessedCount: 100,
          UpdatedAt: Date.now(),
        },
      ];

      mockClickHouseClient.query.mockResolvedValue({
        json: vi.fn().mockResolvedValue(mockRows),
      });

      const checkpoint = await repo.loadCheckpoint(tenantId, aggregateType);

      expect(checkpoint).not.toBeNull();
      expect(checkpoint?.cursor).toBe("cursor-1");
      expect(checkpoint?.lastAggregateId).toBe("agg-1");
      expect(checkpoint?.processedCount).toBe(100);
    });

    it("returns null when no checkpoint exists", async () => {
      mockClickHouseClient.query.mockResolvedValue({
        json: vi.fn().mockResolvedValue([]),
      });

      const checkpoint = await repo.loadCheckpoint(tenantId, aggregateType);

      expect(checkpoint).toBeNull();
    });

    it("returns most recent checkpoint when multiple exist", async () => {
      const mockRows = [
        {
          Cursor: "cursor-old",
          LastAggregateId: "agg-old",
          ProcessedCount: 50,
          UpdatedAt: 1000,
        },
        {
          Cursor: "cursor-new",
          LastAggregateId: "agg-new",
          ProcessedCount: 100,
          UpdatedAt: 2000,
        },
      ];

      mockClickHouseClient.query.mockResolvedValue({
        json: vi.fn().mockResolvedValue(mockRows),
      });

      const checkpoint = await repo.loadCheckpoint(tenantId, aggregateType);

      // Should return first row (most recent due to ORDER BY UpdatedAt DESC LIMIT 1)
      expect(checkpoint?.cursor).toBe("cursor-old");
      expect(checkpoint?.processedCount).toBe(50);
    });

    it("handles empty cursor as undefined", async () => {
      const mockRows = [
        {
          Cursor: "",
          LastAggregateId: "agg-1",
          ProcessedCount: 100,
          UpdatedAt: Date.now(),
        },
      ];

      mockClickHouseClient.query.mockResolvedValue({
        json: vi.fn().mockResolvedValue(mockRows),
      });

      const checkpoint = await repo.loadCheckpoint(tenantId, aggregateType);

      expect(checkpoint?.cursor).toBeUndefined();
    });

    it("handles empty lastAggregateId as undefined", async () => {
      const mockRows = [
        {
          Cursor: "cursor-1",
          LastAggregateId: "",
          ProcessedCount: 100,
          UpdatedAt: Date.now(),
        },
      ];

      mockClickHouseClient.query.mockResolvedValue({
        json: vi.fn().mockResolvedValue(mockRows),
      });

      const checkpoint = await repo.loadCheckpoint(tenantId, aggregateType);

      expect(checkpoint?.lastAggregateId).toBeUndefined();
    });

    it("converts ProcessedCount to number", async () => {
      const mockRows = [
        {
          Cursor: "cursor-1",
          LastAggregateId: "agg-1",
          ProcessedCount: "100", // String from database
          UpdatedAt: Date.now(),
        },
      ];

      mockClickHouseClient.query.mockResolvedValue({
        json: vi.fn().mockResolvedValue(mockRows),
      });

      const checkpoint = await repo.loadCheckpoint(tenantId, aggregateType);

      expect(checkpoint?.processedCount).toBe(100);
      expect(typeof checkpoint?.processedCount).toBe("number");
    });

    it("handles checkpoint with all null/empty fields", async () => {
      const mockRows = [
        {
          Cursor: "",
          LastAggregateId: "",
          ProcessedCount: 0,
          UpdatedAt: Date.now(),
        },
      ];

      mockClickHouseClient.query.mockResolvedValue({
        json: vi.fn().mockResolvedValue(mockRows),
      });

      const checkpoint = await repo.loadCheckpoint(tenantId, aggregateType);

      expect(checkpoint).not.toBeNull();
      expect(checkpoint?.cursor).toBeUndefined();
      expect(checkpoint?.lastAggregateId).toBeUndefined();
      expect(checkpoint?.processedCount).toBe(0);
    });

    it("handles error and logs correctly", async () => {
      const error = new Error("Query failed");
      mockClickHouseClient.query.mockRejectedValue(error);

      await expect(
        repo.loadCheckpoint(tenantId, aggregateType),
      ).rejects.toThrow("Query failed");
    });
  });

  describe("clearCheckpoint()", () => {
    it("clears checkpoint by inserting reset record", async () => {
      await repo.clearCheckpoint(tenantId, aggregateType);

      expect(mockClickHouseClient.insert).toHaveBeenCalled();
      const insertCall = mockClickHouseClient.insert.mock.calls[0];
      expect(insertCall[0].table).toBe("event_log_checkpoints");
      expect(insertCall[0].values[0].TenantId).toBe(tenantId);
      expect(insertCall[0].values[0].AggregateType).toBe(aggregateType);
      expect(insertCall[0].values[0].Cursor).toBe("");
      expect(insertCall[0].values[0].LastAggregateId).toBe("");
      expect(insertCall[0].values[0].ProcessedCount).toBe(0);
    });

    it("sets UpdatedAt to current timestamp", async () => {
      const beforeTime = Date.now();
      await repo.clearCheckpoint(tenantId, aggregateType);
      const afterTime = Date.now();

      const insertCall = mockClickHouseClient.insert.mock.calls[0];
      const updatedAt = insertCall[0].values[0].UpdatedAt;
      expect(updatedAt).toBeGreaterThanOrEqual(beforeTime);
      expect(updatedAt).toBeLessThanOrEqual(afterTime);
    });

    it("multiple clears create multiple reset records", async () => {
      await repo.clearCheckpoint(tenantId, aggregateType);
      await repo.clearCheckpoint(tenantId, aggregateType);
      await repo.clearCheckpoint(tenantId, aggregateType);

      expect(mockClickHouseClient.insert).toHaveBeenCalledTimes(3);
    });

    it("handles error and logs correctly", async () => {
      const error = new Error("Insert failed");
      mockClickHouseClient.insert.mockRejectedValue(error);

      await expect(
        repo.clearCheckpoint(tenantId, aggregateType),
      ).rejects.toThrow("Insert failed");
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

      expect(mockClickHouseClient.insert).toHaveBeenCalledTimes(2);
      const call1 = mockClickHouseClient.insert.mock.calls[0];
      const call2 = mockClickHouseClient.insert.mock.calls[1];

      expect(call1[0].values[0].TenantId).toBe("tenant-1");
      expect(call2[0].values[0].TenantId).toBe("tenant-2");
    });

    it("loads checkpoints isolated by tenant", async () => {
      mockClickHouseClient.query.mockResolvedValue({
        json: vi.fn().mockResolvedValue([
          {
            Cursor: "cursor-1",
            LastAggregateId: "agg-1",
            ProcessedCount: 100,
            UpdatedAt: Date.now(),
          },
        ]),
      });

      await repo.loadCheckpoint("tenant-1", aggregateType);

      const queryCall = mockClickHouseClient.query.mock.calls[0];
      expect(queryCall[0].query_params.tenantId).toBe("tenant-1");
    });

    it("clears checkpoints isolated by tenant", async () => {
      await repo.clearCheckpoint("tenant-1", aggregateType);

      const insertCall = mockClickHouseClient.insert.mock.calls[0];
      expect(insertCall[0].values[0].TenantId).toBe("tenant-1");
    });
  });

  describe("aggregate type isolation", () => {
    it("saves checkpoints isolated by aggregateType", async () => {
      const checkpoint: BulkRebuildCheckpoint<string> = {
        processedCount: 100,
      };

      await repo.saveCheckpoint(tenantId, "trace", checkpoint);
      await repo.saveCheckpoint(tenantId, "user", checkpoint);

      expect(mockClickHouseClient.insert).toHaveBeenCalledTimes(2);
      const call1 = mockClickHouseClient.insert.mock.calls[0];
      const call2 = mockClickHouseClient.insert.mock.calls[1];

      expect(call1[0].values[0].AggregateType).toBe("trace");
      expect(call2[0].values[0].AggregateType).toBe("user");
    });
  });
});
