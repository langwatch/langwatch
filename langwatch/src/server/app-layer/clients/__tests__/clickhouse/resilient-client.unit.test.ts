import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client";

const { mockQueryLogger, mockLogger } = vi.hoisted(() => ({
  mockQueryLogger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
  mockLogger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

vi.mock("~/utils/logger/server", () => ({
  createLogger: (name: string) =>
    name.includes("query") ? mockQueryLogger : mockLogger,
}));

import { createResilientClickHouseClient } from "../../clickhouse/resilient-client";

function makeMockClient(overrides?: Partial<ClickHouseClient>) {
  return {
    insert: vi.fn(),
    query: vi.fn(),
    command: vi.fn(),
    exec: vi.fn(),
    close: vi.fn(),
    ping: vi.fn(),
    ...overrides,
  } as unknown as ClickHouseClient;
}

describe("createResilientClickHouseClient()", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockQueryLogger.debug.mockReset();
    mockQueryLogger.warn.mockReset();
    mockQueryLogger.error.mockReset();
    mockQueryLogger.fatal.mockReset();
    mockLogger.debug.mockReset();
    mockLogger.warn.mockReset();
    mockLogger.error.mockReset();
    mockLogger.fatal.mockReset();
  });

  describe("when insert fails with transient error then succeeds", () => {
    it("retries and returns the result", async () => {
      const transientError = new Error("MEMORY_LIMIT_EXCEEDED");
      const result = { executed: true };
      const mock = makeMockClient({
        insert: vi
          .fn()
          .mockRejectedValueOnce(transientError)
          .mockResolvedValueOnce(result),
      });
      const client = createResilientClickHouseClient({
        client: mock,
        maxRetries: 3,
        baseDelayMs: 1,
      });

      const actual = await client.insert({
        table: "test",
        values: [],
        format: "JSONEachRow",
      });

      expect(actual).toBe(result);
      expect(mock.insert).toHaveBeenCalledTimes(2);
    });

    it("logs a retry warning with structured metadata", async () => {
      const transientError = new Error("MEMORY_LIMIT_EXCEEDED");
      const result = { executed: true };
      const mock = makeMockClient({
        insert: vi
          .fn()
          .mockRejectedValueOnce(transientError)
          .mockResolvedValueOnce(result),
      });
      const client = createResilientClickHouseClient({
        client: mock,
        maxRetries: 3,
        baseDelayMs: 1,
      });

      await client.insert({
        table: "test",
        values: [],
        format: "JSONEachRow",
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          source: "clickhouse",
          operation: "insert",
          attempt: 1,
        }),
        expect.any(String)
      );
    });
  });

  describe("when insert fails with non-transient error", () => {
    it("throws immediately without retrying", async () => {
      const schemaError = new Error("Table does_not_exist doesn't exist");
      const mock = makeMockClient({
        insert: vi.fn().mockRejectedValue(schemaError),
      });
      const client = createResilientClickHouseClient({
        client: mock,
        maxRetries: 3,
        baseDelayMs: 1,
      });

      await expect(
        client.insert({ table: "test", values: [], format: "JSONEachRow" })
      ).rejects.toThrow("Table does_not_exist doesn't exist");
      expect(mock.insert).toHaveBeenCalledTimes(1);
    });
  });

  describe("when all retries are exhausted", () => {
    it("calls maxRetries+1 times then throws the final error", async () => {
      const transientError = new Error("MEMORY_LIMIT_EXCEEDED");
      const mock = makeMockClient({
        insert: vi.fn().mockRejectedValue(transientError),
      });
      const client = createResilientClickHouseClient({
        client: mock,
        maxRetries: 2,
        baseDelayMs: 1,
      });

      await expect(
        client.insert({ table: "test", values: [], format: "JSONEachRow" })
      ).rejects.toThrow("MEMORY_LIMIT_EXCEEDED");
      expect(mock.insert).toHaveBeenCalledTimes(3);
    });
  });

  describe("when query succeeds", () => {
    it("returns the result without retry", async () => {
      const queryResult = { data: [] };
      const mock = makeMockClient({
        query: vi.fn().mockResolvedValue(queryResult),
      });
      const client = createResilientClickHouseClient({
        client: mock,
        maxRetries: 3,
      });

      const qr = await client.query({ query: "SELECT 1" });
      expect(qr).toBe(queryResult);
      expect(mock.query).toHaveBeenCalledTimes(1);
    });

    it("logs structured debug fields", async () => {
      const queryResult = { data: [] };
      const mock = makeMockClient({
        query: vi.fn().mockResolvedValue(queryResult),
      });
      const client = createResilientClickHouseClient({
        client: mock,
        maxRetries: 3,
      });

      await client.query({ query: "SELECT 1" });

      expect(mockQueryLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          source: "clickhouse",
          operation: "query",
        }),
        expect.any(String)
      );
    });
  });

  describe("when query fails", () => {
    it("throws without retrying", async () => {
      const err = new Error("MEMORY_LIMIT_EXCEEDED");
      const mock = makeMockClient({
        query: vi.fn().mockRejectedValue(err),
      });
      const client = createResilientClickHouseClient({
        client: mock,
        maxRetries: 3,
      });

      await expect(
        client.query({ query: "SELECT 1" })
      ).rejects.toThrow("MEMORY_LIMIT_EXCEEDED");
      expect(mock.query).toHaveBeenCalledTimes(1);
    });

    it("logs structured error fields", async () => {
      const err = new Error("MEMORY_LIMIT_EXCEEDED");
      const mock = makeMockClient({
        query: vi.fn().mockRejectedValue(err),
      });
      const client = createResilientClickHouseClient({
        client: mock,
        maxRetries: 3,
      });

      await expect(
        client.query({ query: "SELECT 1" })
      ).rejects.toThrow("MEMORY_LIMIT_EXCEEDED");

      expect(mockQueryLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          source: "clickhouse",
          operation: "query",
        }),
        expect.any(String)
      );
    });

    it("passes the raw error object for Pino serializer", async () => {
      const err = new Error("MEMORY_LIMIT_EXCEEDED");
      const mock = makeMockClient({
        query: vi.fn().mockRejectedValue(err),
      });
      const client = createResilientClickHouseClient({
        client: mock,
        maxRetries: 3,
      });

      await expect(
        client.query({ query: "SELECT 1" })
      ).rejects.toThrow("MEMORY_LIMIT_EXCEEDED");

      const loggedObj = mockQueryLogger.error.mock.calls[0]![0] as Record<
        string,
        unknown
      >;
      expect(loggedObj.error).toBe(err);
    });
  });

  describe("when insert succeeds on first attempt", () => {
    it("calls insert once and returns the result", async () => {
      const result = { executed: true };
      const mock = makeMockClient({
        insert: vi.fn().mockResolvedValue(result),
      });
      const client = createResilientClickHouseClient({
        client: mock,
        maxRetries: 3,
        baseDelayMs: 1,
      });

      const actual = await client.insert({
        table: "test",
        values: [],
        format: "JSONEachRow",
      });

      expect(actual).toBe(result);
      expect(mock.insert).toHaveBeenCalledTimes(1);
    });
  });

  describe("when logging throws during query failure", () => {
    it("still propagates the original ClickHouse error", async () => {
      const chError = new Error("MEMORY_LIMIT_EXCEEDED");
      const mock = makeMockClient({
        query: vi.fn().mockRejectedValue(chError),
      });
      mockQueryLogger.error.mockImplementation(() => {
        throw new Error("pino transport crashed");
      });

      const client = createResilientClickHouseClient({
        client: mock,
        maxRetries: 3,
      });

      await expect(
        client.query({ query: "SELECT 1" })
      ).rejects.toThrow("MEMORY_LIMIT_EXCEEDED");
    });
  });

  describe("when logging throws during insert retry", () => {
    it("still retries and succeeds", async () => {
      const transientError = new Error("MEMORY_LIMIT_EXCEEDED");
      const result = { executed: true };
      const mock = makeMockClient({
        insert: vi
          .fn()
          .mockRejectedValueOnce(transientError)
          .mockResolvedValueOnce(result),
      });
      mockLogger.warn.mockImplementation(() => {
        throw new Error("pino transport crashed");
      });

      const client = createResilientClickHouseClient({
        client: mock,
        maxRetries: 3,
        baseDelayMs: 1,
      });

      const actual = await client.insert({
        table: "test",
        values: [],
        format: "JSONEachRow",
      });

      expect(actual).toBe(result);
      expect(mock.insert).toHaveBeenCalledTimes(2);
    });
  });

  describe("when logging throws during query success", () => {
    it("still returns the query result", async () => {
      const queryResult = { data: [] };
      const mock = makeMockClient({
        query: vi.fn().mockResolvedValue(queryResult),
      });
      mockQueryLogger.debug.mockImplementation(() => {
        throw new Error("pino transport crashed");
      });

      const client = createResilientClickHouseClient({
        client: mock,
        maxRetries: 3,
      });

      const qr = await client.query({ query: "SELECT 1" });
      expect(qr).toBe(queryResult);
    });
  });

  describe("when query exceeds default duration threshold (1s)", () => {
    it("logs at warn level with query preview", async () => {
      const queryResult = { response_headers: {} };
      const mock = makeMockClient({
        query: vi.fn().mockImplementation(async () => {
          await new Promise((r) => setTimeout(r, 1100));
          return queryResult;
        }),
      });
      const client = createResilientClickHouseClient({ client: mock });

      await client.query({ query: "SELECT * FROM big_table WHERE x = 1" });

      expect(mockQueryLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          source: "clickhouse",
          operation: "query",
          query: expect.stringContaining("SELECT * FROM big_table"),
        }),
        expect.stringContaining("ClickHouse slow query")
      );
      expect(mockQueryLogger.debug).not.toHaveBeenCalled();
    });
  });

  describe("when query result exceeds default size threshold (3MB)", () => {
    it("logs at warn level with readBytes", async () => {
      const queryResult = {
        response_headers: {
          "x-clickhouse-summary": JSON.stringify({ read_bytes: "4000000" }),
        },
      };
      const mock = makeMockClient({
        query: vi.fn().mockResolvedValue(queryResult),
      });
      const client = createResilientClickHouseClient({ client: mock });

      await client.query({ query: "SELECT messages FROM traces" });

      expect(mockQueryLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          source: "clickhouse",
          operation: "query",
          readBytes: 4000000,
        }),
        expect.stringContaining("3.0MB expected")
      );
    });
  });

  describe("when query is fast and light", () => {
    it("logs at debug level only", async () => {
      const queryResult = {
        response_headers: {
          "x-clickhouse-summary": JSON.stringify({ read_bytes: "500" }),
        },
      };
      const mock = makeMockClient({
        query: vi.fn().mockResolvedValue(queryResult),
      });
      const client = createResilientClickHouseClient({ client: mock });

      await client.query({ query: "SELECT count() FROM t" });

      expect(mockQueryLogger.debug).toHaveBeenCalled();
      expect(mockQueryLogger.warn).not.toHaveBeenCalled();
    });
  });

  describe("when per-query expectations override defaults", () => {
    it("uses custom thresholds for slow query detection", async () => {
      const queryResult = {
        response_headers: {
          "x-clickhouse-summary": JSON.stringify({ read_bytes: "4000000" }),
        },
      };
      const mock = makeMockClient({
        query: vi.fn().mockResolvedValue(queryResult),
      });
      const client = createResilientClickHouseClient({ client: mock });

      // 4MB is over the default 3MB, but under the custom 5MB
      await client.query({
        query: "SELECT * FROM heavy_table",
        clickhouse_settings: {
          langwatch_expected_max_duration_ms: 5000,
          langwatch_expected_max_read_bytes: 5_000_000,
        },
      } as any);

      expect(mockQueryLogger.debug).toHaveBeenCalled();
      expect(mockQueryLogger.warn).not.toHaveBeenCalled();
    });
  });

  describe("when langwatch_* settings are passed", () => {
    it("strips them before forwarding to ClickHouse", async () => {
      const queryResult = { response_headers: {} };
      const mock = makeMockClient({
        query: vi.fn().mockResolvedValue(queryResult),
      });
      const client = createResilientClickHouseClient({ client: mock });

      await client.query({
        query: "SELECT 1",
        clickhouse_settings: {
          max_memory_usage: 1000000,
          langwatch_expected_max_duration_ms: 5000,
          langwatch_expected_max_read_bytes: 10_000_000,
        },
      } as any);

      const forwarded = (mock.query as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(forwarded.clickhouse_settings).toEqual({
        max_memory_usage: 1000000,
      });
      expect(forwarded.clickhouse_settings).not.toHaveProperty("langwatch_expected_max_duration_ms");
      expect(forwarded.clickhouse_settings).not.toHaveProperty("langwatch_expected_max_read_bytes");
    });
  });

  describe("when both duration and size exceed thresholds", () => {
    it("includes both reasons in the warn message", async () => {
      const queryResult = {
        response_headers: {
          "x-clickhouse-summary": JSON.stringify({ read_bytes: "5000000" }),
        },
      };
      const mock = makeMockClient({
        query: vi.fn().mockImplementation(async () => {
          await new Promise((r) => setTimeout(r, 1100));
          return queryResult;
        }),
      });
      const client = createResilientClickHouseClient({ client: mock });

      await client.query({ query: "SELECT * FROM huge" });

      const msg = mockQueryLogger.warn.mock.calls[0]![1] as string;
      expect(msg).toContain("ms >");
      expect(msg).toContain("MB >");
    });
  });

  describe("when command or close is called", () => {
    it("passes through to the underlying client", async () => {
      const mock = makeMockClient({
        command: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      });
      const client = createResilientClickHouseClient({
        client: mock,
        maxRetries: 3,
      });

      await client.command({ query: "CREATE TABLE ..." });
      expect(mock.command).toHaveBeenCalledTimes(1);

      await client.close();
      expect(mock.close).toHaveBeenCalledTimes(1);
    });
  });
});
