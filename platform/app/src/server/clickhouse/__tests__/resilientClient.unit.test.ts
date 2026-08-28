import type { ClickHouseClient } from "@clickhouse/client";
import { QUERY_CAUSE_FIELD } from "@langwatch/clickhouse-client";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@langwatch/observability", () => ({
  createLogger: (name: string) => (name.includes("query") ? mockQueryLogger : mockLogger),
}));

import {
  createResilientClickHouseClientForTest,
  createResilientClickHouseClientForTest as createResilientClickHouseClient,
} from "../managedClient";

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

describe("createResilientClickHouseClientForTest()", () => {
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

  describe("when insert fails with transient error", () => {
    /** @scenario Insert failures are not retried by the client */
    it("attempts it exactly once and raises for the queue to retry", async () => {
      // Every insert comes from a queued job that retries the whole job, so a
      // retry here multiplies attempts rather than adding resilience. These
      // are also async inserts with deduplication off, so a failure raised
      // after the server buffered the batch can still flush - retrying then
      // writes the rows twice.
      const transientError = new Error("MEMORY_LIMIT_EXCEEDED");
      const mock = makeMockClient({
        insert: vi.fn().mockRejectedValue(transientError),
      });
      const client = createResilientClickHouseClientForTest({
        client: mock,
        maxRetries: 3,
        baseDelayMs: 1,
      });

      await expect(
        client.insert({ table: "test", values: [], format: "JSONEachRow" }),
      ).rejects.toThrow("MEMORY_LIMIT_EXCEEDED");
      expect(mock.insert).toHaveBeenCalledTimes(1);
    });

    it("emits no retry warning, because there is no retry", async () => {
      const mock = makeMockClient({
        insert: vi.fn().mockRejectedValue(new Error("MEMORY_LIMIT_EXCEEDED")),
      });
      const client = createResilientClickHouseClientForTest({
        client: mock,
        maxRetries: 3,
        baseDelayMs: 1,
      });

      await expect(
        client.insert({ table: "test", values: [], format: "JSONEachRow" }),
      ).rejects.toThrow();

      expect(mockLogger.warn).not.toHaveBeenCalledWith(
        expect.objectContaining({ operation: "insert" }),
        expect.any(String),
      );
    });
  });

  describe("when insert fails with non-transient error", () => {
    /** @scenario Non-transient insert errors fail immediately */
    it("throws immediately without retrying", async () => {
      const schemaError = new Error("Table does_not_exist doesn't exist");
      const mock = makeMockClient({
        insert: vi.fn().mockRejectedValue(schemaError),
      });
      const client = createResilientClickHouseClientForTest({
        client: mock,
        maxRetries: 3,
        baseDelayMs: 1,
      });

      await expect(
        client.insert({ table: "test", values: [], format: "JSONEachRow" }),
      ).rejects.toThrow("Table does_not_exist doesn't exist");
      expect(mock.insert).toHaveBeenCalledTimes(1);
    });
  });

  describe("when a read exhausts its retries", () => {
    it("calls maxRetries+1 times then throws the final error", async () => {
      const transientError = new Error("MEMORY_LIMIT_EXCEEDED");
      const mock = makeMockClient({
        query: vi.fn().mockRejectedValue(transientError),
      });
      const client = createResilientClickHouseClientForTest({
        client: mock,
        maxRetries: 2,
        baseDelayMs: 1,
      });

      await expect(client.query({ query: "SELECT 1" } as any)).rejects.toThrow();
      expect(mock.query).toHaveBeenCalledTimes(3);
    });
  });

  describe("when query succeeds", () => {
    it("returns the result without retry", async () => {
      const queryResult = { data: [] };
      const mock = makeMockClient({
        query: vi.fn().mockResolvedValue(queryResult),
      });
      const client = createResilientClickHouseClientForTest({
        client: mock,
        maxRetries: 3,
      });

      const qr = await client.query({ query: "SELECT 1" });
      expect(qr).toBe(queryResult);
      expect(mock.query).toHaveBeenCalledTimes(1);
    });

    /** @scenario Query successes are logged at debug level */
    it("logs structured debug fields", async () => {
      const queryResult = { data: [] };
      const mock = makeMockClient({
        query: vi.fn().mockResolvedValue(queryResult),
      });
      const client = createResilientClickHouseClientForTest({
        client: mock,
        maxRetries: 3,
      });

      await client.query({ query: "SELECT 1" });

      expect(mockQueryLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          source: "clickhouse",
          operation: "query",
        }),
        expect.any(String),
      );
    });
  });

  describe("when query fails with a non-transient error", () => {
    /** @scenario A read failing with a non-transient error fails fast */
    it("throws immediately without retrying", async () => {
      const err = new Error("Syntax error in query");
      const mock = makeMockClient({
        query: vi.fn().mockRejectedValue(err),
      });
      const client = createResilientClickHouseClientForTest({
        client: mock,
        maxRetries: 3,
      });

      await expect(client.query({ query: "SELECT 1" })).rejects.toThrow("Syntax error in query");
      expect(mock.query).toHaveBeenCalledTimes(1);
    });

    /** @scenario Query failures are logged with structured metadata */
    it("logs structured error fields", async () => {
      const err = new Error("Syntax error in query");
      const mock = makeMockClient({
        query: vi.fn().mockRejectedValue(err),
      });
      const client = createResilientClickHouseClientForTest({
        client: mock,
        maxRetries: 3,
      });

      await expect(client.query({ query: "SELECT 1" })).rejects.toThrow("Syntax error in query");

      expect(mockQueryLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          source: "clickhouse",
          operation: "query",
        }),
        expect.any(String),
      );
    });

    // The error is on its way to the caller, which is what knows whether it
    // ends as a 5xx, a retried job, or a dropped one. Reporting it as an error
    // here as well counted recovered work as lost.
    /** @scenario A failed attempt raised to the caller is not itself an error */
    it("reports the attempt at warn, leaving the verdict to the caller", async () => {
      const mock = makeMockClient({
        query: vi.fn().mockRejectedValue(new Error("Syntax error in query")),
      });
      const client = createResilientClickHouseClientForTest({
        client: mock,
        maxRetries: 3,
      });

      await expect(client.query({ query: "SELECT 1" })).rejects.toThrow("Syntax error in query");

      expect(mockQueryLogger.error).not.toHaveBeenCalled();
    });

    it("passes the raw error object for Pino serializer", async () => {
      const err = new Error("Syntax error in query");
      const mock = makeMockClient({
        query: vi.fn().mockRejectedValue(err),
      });
      const client = createResilientClickHouseClientForTest({
        client: mock,
        maxRetries: 3,
      });

      await expect(client.query({ query: "SELECT 1" })).rejects.toThrow("Syntax error in query");

      const loggedObj = mockQueryLogger.warn.mock.calls[0]![0] as Record<string, unknown>;
      expect(loggedObj[QUERY_CAUSE_FIELD]).toBe(err);
    });

    // Loki derives a record's level from a field called `error`, so leaving the
    // cause there re-promotes exactly the records this change moved down.
    /** @scenario The cause rides on the named query-cause field */
    it("keeps the cause off a field named error", async () => {
      const mock = makeMockClient({
        query: vi.fn().mockRejectedValue(new Error("Syntax error in query")),
      });
      const client = createResilientClickHouseClientForTest({
        client: mock,
        maxRetries: 3,
      });

      await expect(client.query({ query: "SELECT 1" })).rejects.toThrow("Syntax error in query");

      expect(mockQueryLogger.warn.mock.calls[0]![0]).not.toHaveProperty("error");
    });
  });

  describe("when query fails with a transient overload error", () => {
    const fastRetryClient = (mock: ClickHouseClient) =>
      createResilientClickHouseClient({
        client: mock,
        maxRetries: 2,
        baseDelayMs: 1,
        maxDelayMs: 2,
      });

    /** @scenario A read rejected for transient overload is retried and succeeds */
    it("retries and returns the result once a slot frees", async () => {
      const overload = new Error(
        "Code: 202. DB::Exception: Too many simultaneous queries. Maximum: 100. ",
      );
      const result = { data: [{ ok: 1 }] };
      const mock = makeMockClient({
        query: vi.fn().mockRejectedValueOnce(overload).mockResolvedValueOnce(result),
      });

      const client = fastRetryClient(mock);
      await expect(client.query({ query: "SELECT 1" })).resolves.toBe(result);
      expect(mock.query).toHaveBeenCalledTimes(2);
    });

    /** @scenario A read that keeps failing transiently eventually surfaces the error */
    it("surfaces the error only after retries are exhausted", async () => {
      const overload = new Error("Too many simultaneous queries. Maximum: 100. ");
      const mock = makeMockClient({
        query: vi.fn().mockRejectedValue(overload),
      });

      const client = fastRetryClient(mock);
      await expect(client.query({ query: "SELECT 1" })).rejects.toThrow(
        "Too many simultaneous queries",
      );
      // maxRetries: 2 -> 1 initial attempt + 2 retries = 3 total
      expect(mock.query).toHaveBeenCalledTimes(3);
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
    /** @scenario Logging crashes do not affect query results */
    it("still propagates the original ClickHouse error", async () => {
      const chError = new Error("Syntax error in query");
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

      await expect(client.query({ query: "SELECT 1" })).rejects.toThrow("Syntax error in query");
    });
  });

  describe("when logging throws during a read retry", () => {
    it("still retries and succeeds", async () => {
      const transientError = new Error("MEMORY_LIMIT_EXCEEDED");
      const queryResult = { data: [] };
      const mock = makeMockClient({
        query: vi.fn().mockRejectedValueOnce(transientError).mockResolvedValueOnce(queryResult),
      });
      mockLogger.warn.mockImplementation(() => {
        throw new Error("pino transport crashed");
      });

      const client = createResilientClickHouseClient({
        client: mock,
        maxRetries: 3,
        baseDelayMs: 1,
      });

      await client.query({ query: "SELECT 1" } as any);

      expect(mock.query).toHaveBeenCalledTimes(2);
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

  describe("when a query cold-scans a time-partitioned table", () => {
    it("logs a cold-scan warning naming the table", async () => {
      const queryResult = { response_headers: {} };
      const mock = makeMockClient({
        query: vi.fn().mockResolvedValue(queryResult),
      });
      const client = createResilientClickHouseClient({ client: mock });

      await client.query({
        query: "SELECT SpanId FROM stored_spans WHERE TenantId = {tenantId:String}",
      });

      expect(mockQueryLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          source: "clickhouse",
          operation: "query",
          coldScan: true,
          coldScanTable: "stored_spans",
        }),
        expect.stringContaining("cold scan of stored_spans"),
      );
      expect(mockQueryLogger.debug).not.toHaveBeenCalled();
    });
  });

  describe("when a successful query does not cold-scan", () => {
    it("logs at debug level only", async () => {
      const queryResult = { response_headers: {} };
      const mock = makeMockClient({
        query: vi.fn().mockResolvedValue(queryResult),
      });
      const client = createResilientClickHouseClient({ client: mock });

      await client.query({
        query: "SELECT count() FROM t WHERE TenantId = {tenantId:String}",
      });

      expect(mockQueryLogger.debug).toHaveBeenCalled();
      expect(mockQueryLogger.warn).not.toHaveBeenCalled();
    });
  });

  describe("when command or close is called", () => {
    /** @scenario Non-query operations pass through to the underlying client */
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

describe("query error translation after retries are exhausted", () => {
  it("throws QueryMemoryExceededError for a 241 driver error, preserving the raw error in reasons", async () => {
    const raw = new Error(
      "Code: 241. DB::Exception: Memory limit (for query) exceeded. (MEMORY_LIMIT_EXCEEDED)",
    );
    const mock = makeMockClient({
      query: vi.fn().mockRejectedValue(raw),
    });
    const client = createResilientClickHouseClient({
      client: mock,
      maxRetries: 1,
      baseDelayMs: 1,
    });

    const { QueryMemoryExceededError } = await import("~/server/app-layer/traces/errors");
    const rejection = await client.query({ query: "SELECT 1" }).catch((e) => e);

    expect(rejection).toBeInstanceOf(QueryMemoryExceededError);
    expect(rejection.reasons).toEqual([raw]);
    // Retries happened first — translation only fires after exhaustion.
    expect(mock.query).toHaveBeenCalledTimes(2);
  });

  it("rethrows unmapped driver errors unchanged", async () => {
    const raw = new Error("Code: 62. DB::Exception: Syntax error");
    const mock = makeMockClient({
      query: vi.fn().mockRejectedValue(raw),
    });
    const client = createResilientClickHouseClient({
      client: mock,
      maxRetries: 1,
      baseDelayMs: 1,
    });

    const rejection = await client.query({ query: "SELECT 1" }).catch((e) => e);

    expect(rejection).toBe(raw);
  });
});
