import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client";
import {
  createResilientClickHouseClient,
  isTransientClickHouseError,
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

describe("createResilientClickHouseClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("when insert succeeds on first attempt", () => {
    it("calls insert once and returns the result", async () => {
      const result = { executed: true };
      const mock = makeMockClient({ insert: vi.fn().mockResolvedValue(result) });
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
        client.insert({ table: "test", values: [], format: "JSONEachRow" }),
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
        client.insert({ table: "test", values: [], format: "JSONEachRow" }),
      ).rejects.toThrow("MEMORY_LIMIT_EXCEEDED");
      expect(mock.insert).toHaveBeenCalledTimes(3);
    });
  });

  describe("when query, command, or close is called", () => {
    it("passes through to the underlying client", async () => {
      const queryResult = { data: [] };
      const mock = makeMockClient({
        query: vi.fn().mockResolvedValue(queryResult),
        command: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      });
      const client = createResilientClickHouseClient({
        client: mock,
        maxRetries: 3,
      });

      const qr = await client.query({ query: "SELECT 1" });
      expect(qr).toBe(queryResult);
      expect(mock.query).toHaveBeenCalledTimes(1);

      await client.command({ query: "CREATE TABLE ..." });
      expect(mock.command).toHaveBeenCalledTimes(1);

      await client.close();
      expect(mock.close).toHaveBeenCalledTimes(1);
    });
  });
});

describe("isTransientClickHouseError", () => {
  describe("when error contains MEMORY_LIMIT_EXCEEDED", () => {
    it("returns true", () => {
      expect(
        isTransientClickHouseError(new Error("MEMORY_LIMIT_EXCEEDED")),
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
        isTransientClickHouseError(new Error("Request Timeout")),
      ).toBe(true);
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
        isTransientClickHouseError(new Error("Table foo doesn't exist")),
      ).toBe(false);
    });

    it("returns false for non-Error values", () => {
      expect(isTransientClickHouseError("string error")).toBe(false);
    });
  });
});
