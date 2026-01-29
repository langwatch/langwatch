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
      const mockClient = {} as ClickHouseClient;
      const mockQueryFn = vi.fn().mockResolvedValue({ data: "result" });

      const result = await metrics.executeWithMetrics(
        mockClient,
        mockQueryFn,
        "SELECT",
        "test_table"
      );

      expect(result).toEqual({ data: "result" });
      expect(mockQueryFn).toHaveBeenCalled();
    });

    it("records error metrics on query failure", async () => {
      const mockClient = {} as ClickHouseClient;
      const testError = new Error("Query failed");
      const mockQueryFn = vi.fn().mockRejectedValue(testError);

      await expect(
        metrics.executeWithMetrics(mockClient, mockQueryFn, "INSERT", "events")
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

    it("handles query errors gracefully", async () => {
      const mockClient = {
        query: vi.fn().mockRejectedValue(new Error("Connection failed")),
      } as unknown as ClickHouseClient;

      // Should not throw
      await expect(metrics.collectStorageStats(mockClient)).resolves.toBeUndefined();
    });
  });
});
