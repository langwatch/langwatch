import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

import {
  createResilientClickHouseClient,
  isTransientClickHouseError,
  classifyClickHouseError,
  FailureRateMonitor,
  type ClickHouseErrorType,
} from "../clickhouse.resilient";

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

describe("classifyClickHouseError()", () => {
  describe("when error contains MEMORY_LIMIT_EXCEEDED", () => {
    it("returns oom", () => {
      expect(classifyClickHouseError(new Error("MEMORY_LIMIT_EXCEEDED"))).toBe(
        "oom"
      );
    });
  });

  describe("when error message matches timeout", () => {
    it("returns timeout for Request Timeout", () => {
      expect(classifyClickHouseError(new Error("Request Timeout"))).toBe(
        "timeout"
      );
    });

    it("returns timeout for ETIMEDOUT code", () => {
      const err = new Error("timed out");
      (err as NodeJS.ErrnoException).code = "ETIMEDOUT";
      expect(classifyClickHouseError(err)).toBe("timeout");
    });
  });

  describe("when error has a network code", () => {
    it("returns network for ECONNRESET", () => {
      const err = new Error("connection reset");
      (err as NodeJS.ErrnoException).code = "ECONNRESET";
      expect(classifyClickHouseError(err)).toBe("network");
    });

    it("returns network for ECONNREFUSED", () => {
      const err = new Error("connection refused");
      (err as NodeJS.ErrnoException).code = "ECONNREFUSED";
      expect(classifyClickHouseError(err)).toBe("network");
    });

    it("returns network for EPIPE", () => {
      const err = new Error("broken pipe");
      (err as NodeJS.ErrnoException).code = "EPIPE";
      expect(classifyClickHouseError(err)).toBe("network");
    });

    it("returns network for ENOTFOUND", () => {
      const err = new Error("not found");
      (err as NodeJS.ErrnoException).code = "ENOTFOUND";
      expect(classifyClickHouseError(err)).toBe("network");
    });
  });

  describe("when error has HTTP 429 status", () => {
    it("returns rate_limit", () => {
      const err = new Error("Too Many Requests") as Error & {
        statusCode: number;
      };
      err.statusCode = 429;
      expect(classifyClickHouseError(err)).toBe("rate_limit");
    });
  });

  describe("when error has HTTP 502 status", () => {
    it("returns unavailable", () => {
      const err = new Error("Bad Gateway") as Error & {
        statusCode: number;
      };
      err.statusCode = 502;
      expect(classifyClickHouseError(err)).toBe("unavailable");
    });
  });

  describe("when error has HTTP 503 status", () => {
    it("returns unavailable", () => {
      const err = new Error("Service Unavailable") as Error & {
        statusCode: number;
      };
      err.statusCode = 503;
      expect(classifyClickHouseError(err)).toBe("unavailable");
    });
  });

  describe("when error contains SYNTAX_ERROR", () => {
    it("returns syntax", () => {
      expect(classifyClickHouseError(new Error("SYNTAX_ERROR near ..."))).toBe(
        "syntax"
      );
    });
  });

  describe("when error contains Unknown column", () => {
    it("returns syntax", () => {
      expect(
        classifyClickHouseError(new Error("Unknown column 'foo'"))
      ).toBe("syntax");
    });
  });

  describe("when error is not recognized", () => {
    it("returns unknown for generic errors", () => {
      expect(classifyClickHouseError(new Error("something else"))).toBe(
        "unknown"
      );
    });

    it("returns unknown for non-Error values", () => {
      expect(classifyClickHouseError("string error")).toBe("unknown");
    });
  });
});

describe("FailureRateMonitor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when failures stay below threshold", () => {
    it("returns false from record()", () => {
      const monitor = new FailureRateMonitor({
        threshold: 5,
        windowMs: 60_000,
      });
      for (let i = 0; i < 4; i++) {
        expect(monitor.record()).toBe(false);
      }
    });
  });

  describe("when failures reach the threshold within the window", () => {
    it("returns true from record()", () => {
      const monitor = new FailureRateMonitor({
        threshold: 5,
        windowMs: 60_000,
      });
      for (let i = 0; i < 4; i++) {
        monitor.record();
      }
      expect(monitor.record()).toBe(true);
    });
  });

  describe("when old failures fall outside the window", () => {
    it("does not count them toward the threshold", () => {
      const monitor = new FailureRateMonitor({
        threshold: 3,
        windowMs: 60_000,
      });
      monitor.record(); // t=0
      monitor.record(); // t=0

      vi.advanceTimersByTime(61_000);

      // Old failures expired, only 1 new one
      expect(monitor.record()).toBe(false);
    });
  });

  describe("when alert fires", () => {
    it("does not fire again until cooldown expires", () => {
      const monitor = new FailureRateMonitor({
        threshold: 2,
        windowMs: 60_000,
      });
      monitor.record();
      expect(monitor.record()).toBe(true); // first alert

      // Immediately add more failures — should NOT alert again
      expect(monitor.record()).toBe(false);
      expect(monitor.record()).toBe(false);
    });

    it("fires again after cooldown expires", () => {
      const monitor = new FailureRateMonitor({
        threshold: 2,
        windowMs: 60_000,
      });
      monitor.record();
      expect(monitor.record()).toBe(true); // first alert

      // Advance past cooldown (default 5 minutes)
      vi.advanceTimersByTime(5 * 60_000 + 1);

      monitor.record();
      expect(monitor.record()).toBe(true); // second alert
    });
  });
});

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

describe("isTransientClickHouseError()", () => {
  describe("when error contains MEMORY_LIMIT_EXCEEDED", () => {
    it("returns true", () => {
      expect(
        isTransientClickHouseError(new Error("MEMORY_LIMIT_EXCEEDED"))
      ).toBe(true);
    });
  });

  describe("when error has a network code", () => {
    it("returns true for ECONNRESET", () => {
      const err = new Error("connection reset");
      (err as NodeJS.ErrnoException).code = "ECONNRESET";
      expect(isTransientClickHouseError(err)).toBe(true);
    });

    it("returns true for ETIMEDOUT", () => {
      const err = new Error("timed out");
      (err as NodeJS.ErrnoException).code = "ETIMEDOUT";
      expect(isTransientClickHouseError(err)).toBe(true);
    });
  });

  describe("when error message contains timeout", () => {
    it("returns true", () => {
      expect(
        isTransientClickHouseError(new Error("Request Timeout"))
      ).toBe(true);
    });
  });

  describe("when error has HTTP 502 status", () => {
    it("returns true", () => {
      const err = new Error("Bad Gateway") as Error & {
        statusCode: number;
      };
      err.statusCode = 502;
      expect(isTransientClickHouseError(err)).toBe(true);
    });
  });

  describe("when error has HTTP 503 status", () => {
    it("returns true", () => {
      const err = new Error("Service Unavailable") as Error & {
        statusCode: number;
      };
      err.statusCode = 503;
      expect(isTransientClickHouseError(err)).toBe(true);
    });
  });

  describe("when error has HTTP 429 status", () => {
    it("returns true", () => {
      const err = new Error("Too Many Requests") as Error & {
        statusCode: number;
      };
      err.statusCode = 429;
      expect(isTransientClickHouseError(err)).toBe(true);
    });
  });

  describe("when error is non-transient", () => {
    it("returns false for schema errors", () => {
      expect(
        isTransientClickHouseError(new Error("Table foo doesn't exist"))
      ).toBe(false);
    });

    it("returns false for non-Error values", () => {
      expect(isTransientClickHouseError("string error")).toBe(false);
    });
  });
});
