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

  describe("when an insert fails with a cluster-recovery transient error", () => {
    const transientCases = [
      {
        label: "TOO_MANY_SIMULTANEOUS_QUERIES (overload, message-only)",
        message: "Code: 202. DB::Exception: Too many simultaneous queries. Maximum: 100.",
      },
      {
        label: "MEMORY_LIMIT_EXCEEDED (overload, message-only)",
        message: "Code: 241. DB::Exception: Memory limit (for query) exceeded: would use 3.5 GiB (MEMORY_LIMIT_EXCEEDED)",
      },
      {
        label: "QUERY_WAS_CANCELLED (CH replica graceful shutdown)",
        message: "Code: 394. DB::Exception: Query was cancelled. (QUERY_WAS_CANCELLED)",
      },
      {
        label: "TABLE_IS_READ_ONLY (ZK session lost)",
        message: "Code: 242. DB::Exception: Table is in readonly mode (replica path: /clickhouse/tables/...)",
      },
      {
        label: "KEEPER_EXCEPTION Session expired",
        message: "Code: 999. Coordination::Exception: Session expired. (KEEPER_EXCEPTION)",
      },
      {
        label: "KEEPER_EXCEPTION Connection loss",
        message: "Code: 999. Coordination::Exception: Coordination error: Connection loss.",
      },
    ] as const;

    for (const { label, message } of transientCases) {
      it(`retries the insert for ${label}`, async () => {
        const insert = vi
          .fn()
          .mockRejectedValueOnce(new Error(message))
          .mockResolvedValueOnce(undefined);
        const client = {
          query: vi.fn(),
          insert,
        } as unknown as ClickHouseClient;

        const wrapper = createResilientClickHouseClient({
          client,
          maxRetries: 2,
          baseDelayMs: 1,
          maxDelayMs: 1,
        });

        await wrapper.insert({ table: "events", values: [] } as any);

        expect(insert).toHaveBeenCalledTimes(2);
        expect(mockIncrementQueryCount).toHaveBeenCalledWith("INSERT", "success");
      });
    }
  });
});
