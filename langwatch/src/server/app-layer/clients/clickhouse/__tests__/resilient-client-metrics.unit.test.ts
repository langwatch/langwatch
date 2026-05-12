import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client";

// Mock the metrics module to spy on calls
const mockObserveQueryDuration = vi.fn();
const mockIncrementQueryCount = vi.fn();

vi.mock("~/server/clickhouse/metrics", () => ({
  observeClickHouseQueryDuration: (...args: any[]) => mockObserveQueryDuration(...args),
  incrementClickHouseQueryCount: (...args: any[]) => mockIncrementQueryCount(...args),
}));

// Must import after mock setup
import { createResilientClickHouseClient } from "../resilient-client";

describe("createResilientClickHouseClient()", () => {
  let mockClient: ClickHouseClient;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when a query succeeds", () => {
    beforeEach(() => {
      mockClient = {
        query: vi.fn().mockResolvedValue({
          response_headers: {},
        }),
        insert: vi.fn().mockResolvedValue(undefined),
      } as unknown as ClickHouseClient;
    });

    it("records SELECT query duration and success count", async () => {
      const wrapper = createResilientClickHouseClient({ client: mockClient });
      await wrapper.query({ query: "SELECT * FROM traces" } as any);

      expect(mockObserveQueryDuration).toHaveBeenCalledWith(
        "SELECT",
        "unknown",
        expect.any(Number),
      );
      expect(mockIncrementQueryCount).toHaveBeenCalledWith("SELECT", "success");
    });

    it("detects INSERT query type from query string", async () => {
      const wrapper = createResilientClickHouseClient({ client: mockClient });
      await wrapper.query({ query: "INSERT INTO events VALUES ..." } as any);

      expect(mockObserveQueryDuration).toHaveBeenCalledWith(
        "INSERT",
        "unknown",
        expect.any(Number),
      );
    });

    it("extracts table name from params when available", async () => {
      const wrapper = createResilientClickHouseClient({ client: mockClient });
      await wrapper.query({ query: "SELECT * FROM traces", table: "traces" } as any);

      expect(mockObserveQueryDuration).toHaveBeenCalledWith(
        "SELECT",
        "traces",
        expect.any(Number),
      );
    });
  });

  describe("when a query fails", () => {
    beforeEach(() => {
      mockClient = {
        query: vi.fn().mockRejectedValue(new Error("Query failed")),
        insert: vi.fn().mockRejectedValue(new Error("Insert failed")),
      } as unknown as ClickHouseClient;
    });

    it("records error metrics for failed queries", async () => {
      const wrapper = createResilientClickHouseClient({ client: mockClient });
      await expect(
        wrapper.query({ query: "SELECT * FROM traces" } as any),
      ).rejects.toThrow("Query failed");

      expect(mockObserveQueryDuration).toHaveBeenCalledWith(
        "SELECT",
        "unknown",
        expect.any(Number),
      );
      expect(mockIncrementQueryCount).toHaveBeenCalledWith("SELECT", "error");
    });
  });

  describe("when an insert succeeds", () => {
    beforeEach(() => {
      mockClient = {
        query: vi.fn(),
        insert: vi.fn().mockResolvedValue(undefined),
      } as unknown as ClickHouseClient;
    });

    it("records INSERT metrics with table name", async () => {
      const wrapper = createResilientClickHouseClient({ client: mockClient });
      await wrapper.insert({ table: "events", values: [] } as any);

      expect(mockObserveQueryDuration).toHaveBeenCalledWith(
        "INSERT",
        "events",
        expect.any(Number),
      );
      expect(mockIncrementQueryCount).toHaveBeenCalledWith("INSERT", "success");
    });
  });

  describe("when an insert fails with non-transient error", () => {
    beforeEach(() => {
      mockClient = {
        query: vi.fn(),
        insert: vi.fn().mockRejectedValue(new Error("Permanent failure")),
      } as unknown as ClickHouseClient;
    });

    it("records INSERT error metrics", async () => {
      const wrapper = createResilientClickHouseClient({ client: mockClient, maxRetries: 0 });
      await expect(
        wrapper.insert({ table: "events", values: [] } as any),
      ).rejects.toThrow("Permanent failure");

      expect(mockObserveQueryDuration).toHaveBeenCalledWith(
        "INSERT",
        "events",
        expect.any(Number),
      );
      expect(mockIncrementQueryCount).toHaveBeenCalledWith("INSERT", "error");
    });
  });
});
