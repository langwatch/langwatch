import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ClickHouseRawInsert,
  type ClickHouseRawQuery,
  type ClickHouseTransport,
  createClickHouseClient,
} from "./clickhouseClient";
import type { WriteTarget } from "./retryPolicy";

function connectionResetError(): Error {
  const error = new Error("socket hang up") as NodeJS.ErrnoException;
  error.code = "ECONNRESET";
  return error;
}

function memoryLimitExceededError(): Error {
  const error = new Error("Memory limit exceeded") as NodeJS.ErrnoException;
  error.code = "241";
  return error;
}

interface FakeTransport extends ClickHouseTransport {
  readonly queryCalls: ClickHouseRawQuery[];
  readonly insertCalls: ClickHouseRawInsert[];
}

function createFakeTransport(
  overrides: {
    query?: (
      request: ClickHouseRawQuery,
      callIndex: number,
    ) => Promise<{ rows: unknown[][] }>;
    stream?: (request: ClickHouseRawQuery) => AsyncIterable<unknown[][]>;
    insert?: (request: ClickHouseRawInsert, callIndex: number) => Promise<void>;
  } = {},
): FakeTransport {
  const queryCalls: ClickHouseRawQuery[] = [];
  const insertCalls: ClickHouseRawInsert[] = [];

  return {
    queryCalls,
    insertCalls,
    async query(request) {
      queryCalls.push(request);
      if (overrides.query)
        return overrides.query(request, queryCalls.length - 1);
      return { rows: [] };
    },
    stream(request) {
      queryCalls.push(request);
      if (overrides.stream) return overrides.stream(request);
      return (async function* () {})();
    },
    async insert(request) {
      insertCalls.push(request);
      if (overrides.insert)
        return overrides.insert(request, insertCalls.length - 1);
    },
    async close() {},
  };
}

const REPLACING: WriteTarget = { kind: "replacing" };
const APPEND_NO_IDENTITY: WriteTarget = {
  kind: "append",
  perRecordIdentity: false,
};
const APPEND_WITH_IDENTITY: WriteTarget = {
  kind: "append",
  perRecordIdentity: true,
};
const AGGREGATING: WriteTarget = { kind: "aggregating" };

/** Polls with real timers until `predicate` holds, so tests never guess a fixed microtask depth. */
async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

describe("given createClickHouseClient()", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when a select fails once with a transport error then succeeds", () => {
    it("retries and returns the second attempt's result", async () => {
      vi.useFakeTimers();
      const transport = createFakeTransport({
        query: async (_request, callIndex) => {
          if (callIndex === 0) throw connectionResetError();
          return { rows: [["ok"]] };
        },
      });
      const client = createClickHouseClient({ url: "http://ch", transport });

      const resultPromise = client.query({ tenantId: "t1", sql: "SELECT 1" });
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.rows).toEqual([["ok"]]);
      expect(transport.queryCalls).toHaveLength(2);
    });
  });

  describe("when a select fails with a memory-limit error", () => {
    it("does not retry and throws", async () => {
      const transport = createFakeTransport({
        query: async () => {
          throw memoryLimitExceededError();
        },
      });
      const client = createClickHouseClient({ url: "http://ch", transport });

      await expect(
        client.query({ tenantId: "t1", sql: "SELECT 1" }),
      ).rejects.toThrow();
      expect(transport.queryCalls).toHaveLength(1);
    });
  });

  describe("when an insert into an aggregating table fails transiently", () => {
    it("never retries", async () => {
      const transport = createFakeTransport({
        insert: async () => {
          throw connectionResetError();
        },
      });
      const client = createClickHouseClient({ url: "http://ch", transport });

      await expect(
        client.insert({
          tenantId: "t1",
          table: "rollup",
          rows: [[1]],
          columns: ["value"],
          target: AGGREGATING,
        }),
      ).rejects.toThrow();
      expect(transport.insertCalls).toHaveLength(1);
    });
  });

  describe("when an insert into an append table without per-record identity fails transiently", () => {
    it("never retries", async () => {
      const transport = createFakeTransport({
        insert: async () => {
          throw connectionResetError();
        },
      });
      const client = createClickHouseClient({ url: "http://ch", transport });

      await expect(
        client.insert({
          tenantId: "t1",
          table: "spans",
          rows: [[1]],
          columns: ["value"],
          target: APPEND_NO_IDENTITY,
        }),
      ).rejects.toThrow();
      expect(transport.insertCalls).toHaveLength(1);
    });
  });

  describe("when an insert into an append table with per-record identity fails transiently", () => {
    it("retries until it succeeds", async () => {
      vi.useFakeTimers();
      const transport = createFakeTransport({
        insert: async (_request, callIndex) => {
          if (callIndex === 0) throw connectionResetError();
        },
      });
      const client = createClickHouseClient({ url: "http://ch", transport });

      const insertPromise = client.insert({
        tenantId: "t1",
        table: "spans",
        rows: [[1]],
        columns: ["value"],
        target: APPEND_WITH_IDENTITY,
      });
      await vi.runAllTimersAsync();
      await insertPromise;

      expect(transport.insertCalls).toHaveLength(2);
    });
  });

  describe("when an insert into a replacing table fails transiently", () => {
    it("retries until it succeeds", async () => {
      vi.useFakeTimers();
      const transport = createFakeTransport({
        insert: async (_request, callIndex) => {
          if (callIndex === 0) throw connectionResetError();
        },
      });
      const client = createClickHouseClient({ url: "http://ch", transport });

      const insertPromise = client.insert({
        tenantId: "t1",
        table: "trace_analytics",
        rows: [[1]],
        columns: ["value"],
        target: REPLACING,
      });
      await vi.runAllTimersAsync();
      await insertPromise;

      expect(transport.insertCalls).toHaveLength(2);
    });
  });

  describe("given repeated transient failures", () => {
    it("grows the backoff ceiling and jitters it rather than using a fixed delay", async () => {
      vi.useFakeTimers();
      const transport = createFakeTransport({
        query: async (_request, callIndex) => {
          if (callIndex < 3) throw connectionResetError();
          return { rows: [] };
        },
      });
      const client = createClickHouseClient({
        url: "http://ch",
        transport,
        maxOpenConnections: 20,
      });
      const setTimeoutSpy = vi.spyOn(global, "setTimeout");

      const resultPromise = client.query({ tenantId: "t1", sql: "SELECT 1" });
      await vi.runAllTimersAsync();
      await resultPromise;

      const delays = setTimeoutSpy.mock.calls.map(([, delay]) => Number(delay));
      expect(delays.length).toBeGreaterThanOrEqual(2);
      for (const delay of delays) {
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThanOrEqual(10_000);
      }
      expect(new Set(delays).size).toBeGreaterThan(1);

      setTimeoutSpy.mockRestore();
    });
  });

  describe("given two tenants issuing more queries than maxConcurrentPerTenant allows", () => {
    it("caps each tenant's own concurrency without limiting the other tenant", async () => {
      const inFlight = new Map<string, number>();
      const maxObservedByTenant = new Map<string, number>();
      const releasers: Array<() => void> = [];

      const transport = createFakeTransport({
        query: async (request) => {
          const tenantId = String(request.params?.tenantId ?? "unknown");
          const current = (inFlight.get(tenantId) ?? 0) + 1;
          inFlight.set(tenantId, current);
          maxObservedByTenant.set(
            tenantId,
            Math.max(maxObservedByTenant.get(tenantId) ?? 0, current),
          );
          await new Promise<void>((resolve) => releasers.push(resolve));
          // Decrement relative to the live counter, not the value captured at
          // start — two overlapping calls for the same tenant may finish in
          // either order, and decrementing from a stale snapshot under-counts.
          inFlight.set(tenantId, (inFlight.get(tenantId) ?? 0) - 1);
          return { rows: [] };
        },
      });

      const client = createClickHouseClient({
        url: "http://ch",
        transport,
        maxConcurrentPerTenant: 2,
      });

      const runFor = (tenantId: string, count: number) =>
        Array.from({ length: count }, () =>
          client.query({ tenantId, sql: "SELECT 1", params: { tenantId } }),
        );

      const tenantAQueries = runFor("tenant-a", 4);
      const tenantBQueries = runFor("tenant-b", 4);

      // Let every query that can start, start — exactly 2 per tenant, the
      // other 2 per tenant queued behind the bulkhead.
      await waitUntil(() => releasers.length === 4);

      expect(maxObservedByTenant.get("tenant-a")).toBe(2);
      expect(maxObservedByTenant.get("tenant-b")).toBe(2);

      // Release the first wave; the queued queries should now start, each
      // still capped at 2 concurrently for its own tenant.
      const firstWave = releasers.splice(0, releasers.length);
      firstWave.forEach((release) => release());
      await waitUntil(() => releasers.length === 4);

      const secondWave = releasers.splice(0, releasers.length);
      secondWave.forEach((release) => release());

      await Promise.all([...tenantAQueries, ...tenantBQueries]);

      expect(maxObservedByTenant.get("tenant-a")).toBe(2);
      expect(maxObservedByTenant.get("tenant-b")).toBe(2);
    });
  });

  describe("given a streamed read", () => {
    it("pulls rows lazily instead of buffering the whole result up front", async () => {
      let chunksProduced = 0;
      const transport = createFakeTransport({
        stream: async function* () {
          chunksProduced++;
          yield [["row-1"]];
          chunksProduced++;
          yield [["row-2"]];
        },
      });
      const client = createClickHouseClient({ url: "http://ch", transport });

      const iterator = client
        .stream({ tenantId: "t1", sql: "SELECT * FROM big_table" })
        [Symbol.asyncIterator]();

      const first = await iterator.next();
      expect(first.value).toEqual([["row-1"]]);
      expect(chunksProduced).toBe(1);

      const second = await iterator.next();
      expect(second.value).toEqual([["row-2"]]);
      expect(chunksProduced).toBe(2);

      const third = await iterator.next();
      expect(third.done).toBe(true);
    });
  });

  describe("given an insert", () => {
    /** @scenario a durable write resolves only once the block has landed */
    it("carries both async-insert settings so the write is never fire-and-forget", async () => {
      const transport = createFakeTransport();
      const client = createClickHouseClient({ url: "http://ch", transport });

      await client.insert({
        tenantId: "t1",
        table: "trace_analytics",
        rows: [[1]],
        columns: ["value"],
        target: REPLACING,
      });

      expect(transport.insertCalls).toHaveLength(1);
      expect(transport.insertCalls[0]?.settings).toMatchObject({
        async_insert: 1,
        wait_for_async_insert: 1,
        input_format_skip_unknown_fields: 0,
      });
    });

    it("skips the transport call entirely for an empty batch", async () => {
      const transport = createFakeTransport();
      const client = createClickHouseClient({ url: "http://ch", transport });

      await client.insert({
        tenantId: "t1",
        table: "trace_analytics",
        rows: [],
        columns: ["value"],
        target: REPLACING,
      });

      expect(transport.insertCalls).toHaveLength(0);
    });
  });

  describe("given close()", () => {
    it("closes the underlying transport", async () => {
      const closeSpy = vi.fn().mockResolvedValue(undefined);
      const transport = { ...createFakeTransport(), close: closeSpy };
      const client = createClickHouseClient({ url: "http://ch", transport });

      await client.close();

      expect(closeSpy).toHaveBeenCalledOnce();
    });
  });
});
