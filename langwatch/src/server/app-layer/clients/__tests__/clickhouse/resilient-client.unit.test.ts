import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client";

const {
  mockQueryLogger,
  mockLogger,
  mockIncrementCount,
  mockObserveDuration,
} = vi.hoisted(() => ({
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
  mockIncrementCount: vi.fn(),
  mockObserveDuration: vi.fn(),
}));

vi.mock("~/utils/logger/server", () => ({
  createLogger: (name: string) =>
    name.includes("query") ? mockQueryLogger : mockLogger,
}));

vi.mock("~/server/clickhouse/metrics", () => ({
  observeClickHouseQueryDuration: (...args: unknown[]) =>
    mockObserveDuration(...args),
  incrementClickHouseQueryCount: (...args: unknown[]) =>
    mockIncrementCount(...args),
}));

import { createResilientClickHouseClient } from "../../clickhouse/resilient-client";
import { FailureRateMonitor } from "../../clickhouse/failure-monitor";

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
    mockQueryLogger.debug.mockClear();
    mockQueryLogger.warn.mockClear();
    mockQueryLogger.error.mockClear();
    mockQueryLogger.fatal.mockClear();
    mockLogger.debug.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
    mockLogger.fatal.mockClear();
    mockIncrementCount.mockClear();
    mockObserveDuration.mockClear();
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

    it("increments error metric for the transient failure", async () => {
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

      // Transient failure increments error, success increments success
      expect(mockIncrementCount).toHaveBeenCalledWith("INSERT", "error");
      expect(mockIncrementCount).toHaveBeenCalledWith("INSERT", "success");
    });

    it("feeds the failure rate monitor on transient retries", async () => {
      const transientError = new Error("MEMORY_LIMIT_EXCEEDED");
      const result = { executed: true };
      const mock = makeMockClient({
        insert: vi
          .fn()
          .mockRejectedValueOnce(transientError)
          .mockResolvedValueOnce(result),
      });
      const monitor = new FailureRateMonitor({
        threshold: 1,
        windowMs: 60_000,
      });
      const recordSpy = vi.spyOn(monitor, "record");

      const client = createResilientClickHouseClient({
        client: mock,
        failureMonitor: monitor,
        maxRetries: 3,
        baseDelayMs: 1,
      });

      await client.insert({
        table: "test",
        values: [],
        format: "JSONEachRow",
      });

      expect(recordSpy).toHaveBeenCalledTimes(1);
    });

    it("emits fatal alert when transient retry crosses threshold", async () => {
      const transientError = new Error("MEMORY_LIMIT_EXCEEDED");
      const result = { executed: true };
      const mock = makeMockClient({
        insert: vi
          .fn()
          .mockRejectedValueOnce(transientError)
          .mockResolvedValueOnce(result),
      });
      const monitor = new FailureRateMonitor({
        threshold: 1,
        windowMs: 60_000,
      });

      const client = createResilientClickHouseClient({
        client: mock,
        failureMonitor: monitor,
        maxRetries: 3,
        baseDelayMs: 1,
      });

      await client.insert({
        table: "test",
        values: [],
        format: "JSONEachRow",
      });

      expect(mockQueryLogger.fatal).toHaveBeenCalledWith(
        expect.objectContaining({
          alert: true,
          recentErrorType: "oom",
          windowMinutes: 1,
        }),
        "ClickHouse failure rate threshold exceeded"
      );
    });

    it("includes source and errorType in retry warning log", async () => {
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
          errorType: "oom",
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
          errorType: "oom",
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

  describe("when failure rate threshold is breached", () => {
    it("logs a fatal alert", async () => {
      const err = new Error("MEMORY_LIMIT_EXCEEDED");
      const mock = makeMockClient({
        query: vi.fn().mockRejectedValue(err),
      });
      const monitor = new FailureRateMonitor({
        threshold: 1,
        windowMs: 60_000,
      });
      const client = createResilientClickHouseClient({
        client: mock,
        failureMonitor: monitor,
        maxRetries: 3,
      });

      await expect(
        client.query({ query: "SELECT 1" })
      ).rejects.toThrow("MEMORY_LIMIT_EXCEEDED");

      expect(mockQueryLogger.fatal).toHaveBeenCalledWith(
        expect.objectContaining({
          alert: true,
          source: "clickhouse",
        }),
        expect.any(String)
      );
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

    it("increments metrics with INSERT and success", async () => {
      const result = { executed: true };
      const mock = makeMockClient({
        insert: vi.fn().mockResolvedValue(result),
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

      expect(mockIncrementCount).toHaveBeenCalledWith("INSERT", "success");
    });

    it("passes table name to duration metrics", async () => {
      const result = { executed: true };
      const mock = makeMockClient({
        insert: vi.fn().mockResolvedValue(result),
      });
      const client = createResilientClickHouseClient({
        client: mock,
        maxRetries: 3,
        baseDelayMs: 1,
      });

      await client.insert({
        table: "my_table",
        values: [],
        format: "JSONEachRow",
      });

      expect(mockObserveDuration).toHaveBeenCalledWith(
        "INSERT",
        "my_table",
        expect.any(Number)
      );
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
      mockIncrementCount.mockImplementation(() => {
        throw new Error("prometheus registry corrupted");
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
