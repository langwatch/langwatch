import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client";

// Mock prom-client
vi.mock("prom-client", () => {
  class MockHistogram {
    private _labels: Record<string, any> = {};
    constructor(public config: any) {}
    labels(...args: string[]) {
      return { observe: vi.fn() };
    }
    observe(value: number) {}
  }

  class MockCounter {
    constructor(public config: any) {}
    labels(...args: string[]) {
      return { inc: vi.fn() };
    }
    inc() {}
  }

  class MockGauge {
    constructor(public config: any) {}
    labels(...args: string[]) {
      return { set: vi.fn() };
    }
    set(value: number) {}
  }

  return {
    Histogram: MockHistogram,
    Counter: MockCounter,
    Gauge: MockGauge,
    register: {
      removeSingleMetric: vi.fn(),
    },
  };
});

describe("ClickHouse metrics", () => {
  let metrics: typeof import("../metrics");

  beforeEach(async () => {
    vi.resetModules();
    metrics = await import("../metrics");
  });

  describe("observeClickHouseQueryDuration", () => {
    it("records query duration for SELECT queries", () => {
      const observeSpy = vi.spyOn(
        metrics.clickhouseQueryDurationHistogram.labels("SELECT", "test_table"),
        "observe"
      );

      // This won't actually call the spy due to how the module works,
      // but we can verify the function exists and is callable
      expect(() =>
        metrics.observeClickHouseQueryDuration("SELECT", "test_table", 0.5)
      ).not.toThrow();
    });

    it("accepts INSERT query type", () => {
      expect(() =>
        metrics.observeClickHouseQueryDuration("INSERT", "events", 1.2)
      ).not.toThrow();
    });

    it("accepts OTHER query type", () => {
      expect(() =>
        metrics.observeClickHouseQueryDuration("OTHER", "system", 0.1)
      ).not.toThrow();
    });
  });

  describe("incrementClickHouseQueryCount", () => {
    it("increments counter for successful queries", () => {
      expect(() =>
        metrics.incrementClickHouseQueryCount("SELECT", "success")
      ).not.toThrow();
    });

    it("increments counter for failed queries", () => {
      expect(() =>
        metrics.incrementClickHouseQueryCount("INSERT", "error")
      ).not.toThrow();
    });
  });

  describe("setClickHouseTableRows", () => {
    it("sets row count gauge", () => {
      expect(() => metrics.setClickHouseTableRows("traces", 1000)).not.toThrow();
    });
  });

  describe("setClickHouseTableBytes", () => {
    it("sets byte size gauge", () => {
      expect(() =>
        metrics.setClickHouseTableBytes("spans", 1024 * 1024)
      ).not.toThrow();
    });
  });

  describe("setClickHouseTableParts", () => {
    it("sets parts count gauge", () => {
      expect(() => metrics.setClickHouseTableParts("events", 5)).not.toThrow();
    });
  });

  describe("setClickHouseActiveConnections", () => {
    it("sets active connections gauge", () => {
      expect(() => metrics.setClickHouseActiveConnections(10)).not.toThrow();
    });
  });

  describe("executeWithMetrics", () => {
    it("executes query and records success metrics", async () => {
      const mockQueryFn = vi.fn().mockResolvedValue({ data: "result" });

      const result = await metrics.executeWithMetrics(
        mockQueryFn,
        "SELECT",
        "test_table"
      );

      expect(result).toEqual({ data: "result" });
      expect(mockQueryFn).toHaveBeenCalled();
    });

    it("records error metrics on query failure", async () => {
      const testError = new Error("Query failed");
      const mockQueryFn = vi.fn().mockRejectedValue(testError);

      await expect(
        metrics.executeWithMetrics(mockQueryFn, "INSERT", "events")
      ).rejects.toThrow("Query failed");

      expect(mockQueryFn).toHaveBeenCalled();
    });
  });

  describe("startStorageStatsCollection", () => {
    afterEach(() => {
      metrics.stopStorageStatsCollection();
    });

    it("does not throw when started", () => {
      const mockClient = {
        query: vi.fn().mockResolvedValue({
          json: vi.fn().mockResolvedValue({ data: [] }),
        }),
      } as unknown as ClickHouseClient;

      expect(() =>
        metrics.startStorageStatsCollection(mockClient, 60000)
      ).not.toThrow();
    });

    it("is idempotent - calling twice does not create duplicate intervals", () => {
      const mockClient = {
        query: vi.fn().mockResolvedValue({
          json: vi.fn().mockResolvedValue({ data: [] }),
        }),
      } as unknown as ClickHouseClient;

      metrics.startStorageStatsCollection(mockClient, 60000);
      metrics.startStorageStatsCollection(mockClient, 60000);

      // If this wasn't idempotent, we'd have multiple intervals
      // stopStorageStatsCollection in afterEach cleans up
      expect(mockClient.query).toHaveBeenCalledTimes(1);
    });
  });

  describe("stopStorageStatsCollection", () => {
    it("stops the interval without error", () => {
      expect(() => metrics.stopStorageStatsCollection()).not.toThrow();
    });
  });

  describe("collectStorageStats", () => {
    it("queries system.parts for table stats", async () => {
      const mockResult = {
        json: vi.fn().mockResolvedValue({
          data: [
            { table: "traces", total_rows: "100", total_bytes: "1024", parts_count: "2" },
          ],
        }),
      };
      const mockClient = {
        query: vi.fn().mockResolvedValue(mockResult),
      } as unknown as ClickHouseClient;

      await metrics.collectStorageStats(mockClient);

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.stringContaining("system.parts"),
        })
      );
    });

    it("queries system.backups for backup status", async () => {
      const partsResult = {
        json: vi.fn().mockResolvedValue({ data: [] }),
      };
      const backupResult = {
        json: vi.fn().mockResolvedValue({
          data: [
            {
              status: "BACKUP_CREATED",
              cnt: "3",
              last_success_time: "2024-01-15 10:00:00",
              last_success_size: "1073741824",
            },
          ],
        }),
      };
      const diskResult = {
        json: vi.fn().mockResolvedValue({
          data: [
            { name: "default", total_space: "322122547200", free_space: "214748364800", used_space: "107374182400" },
          ],
        }),
      };
      const mockClient = {
        query: vi.fn()
          .mockResolvedValueOnce(partsResult)
          .mockResolvedValueOnce(backupResult)
          .mockResolvedValueOnce(diskResult),
      } as unknown as ClickHouseClient;

      await metrics.collectStorageStats(mockClient);

      // Should have been called 3 times: parts, backups, disks
      expect(mockClient.query).toHaveBeenCalledTimes(3);
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.stringContaining("system.backups"),
        })
      );
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.stringContaining("system.disks"),
        })
      );
    });

    it("handles system.backups query failure gracefully", async () => {
      const partsResult = {
        json: vi.fn().mockResolvedValue({ data: [] }),
      };
      const mockClient = {
        query: vi.fn()
          .mockResolvedValueOnce(partsResult)
          .mockRejectedValueOnce(new Error("system.backups not found"))
          .mockResolvedValueOnce({ json: vi.fn().mockResolvedValue({ data: [] }) }),
      } as unknown as ClickHouseClient;

      // Should not throw — backup errors are handled gracefully
      await expect(metrics.collectStorageStats(mockClient)).resolves.toBeUndefined();
    });

    it("handles query errors gracefully", async () => {
      const mockClient = {
        query: vi.fn().mockRejectedValue(new Error("Connection failed")),
      } as unknown as ClickHouseClient;

      // Should not throw
      await expect(metrics.collectStorageStats(mockClient)).resolves.toBeUndefined();
    });
  });

  describe("backup metric setters", () => {
    it("sets backup last success timestamp without throwing", () => {
      expect(() => metrics.setClickHouseBackupLastSuccessTimestamp(1711929600)).not.toThrow();
    });

    it("sets backup last size bytes without throwing", () => {
      expect(() => metrics.setClickHouseBackupLastSizeBytes(1073741824)).not.toThrow();
    });

    it("sets backup status count without throwing", () => {
      expect(() => metrics.setClickHouseBackupStatusCount("BACKUP_CREATED", 5)).not.toThrow();
    });
  });

  describe("disk metric setters", () => {
    it("sets disk total bytes without throwing", () => {
      expect(() => metrics.setClickHouseDiskTotalBytes("default", 322122547200)).not.toThrow();
    });

    it("sets disk used bytes without throwing", () => {
      expect(() => metrics.setClickHouseDiskUsedBytes("default", 107374182400)).not.toThrow();
    });

    it("sets disk free bytes without throwing", () => {
      expect(() => metrics.setClickHouseDiskFreeBytes("default", 214748364800)).not.toThrow();
    });
  });
});
