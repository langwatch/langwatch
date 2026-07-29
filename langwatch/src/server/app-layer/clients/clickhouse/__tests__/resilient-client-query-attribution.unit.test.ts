import type { ClickHouseClient } from "@clickhouse/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/clickhouse/metrics", () => ({
  observeClickHouseQueryDuration: vi.fn(),
  incrementClickHouseQueryCount: vi.fn(),
}));

import { createResilientClickHouseClient } from "../resilient-client";

/**
 * `specs/clickhouse/query-attribution.feature` — the client must send a query
 * id IT chose.
 *
 * The point is not the id itself but what having one enables: ClickHouse
 * records every query it runs in `system.query_log` keyed by `query_id`, and
 * while the driver generates that id internally and tells nobody, the server's
 * record of a failed query — its text, what it read, how much memory it took —
 * exists but cannot be tied back to the request that issued it.
 */

describe("createResilientClickHouseClient()", () => {
  let mockClient: ClickHouseClient;
  let query: ReturnType<typeof vi.fn>;
  let insert: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    query = vi.fn().mockResolvedValue({ response_headers: {} });
    insert = vi.fn().mockResolvedValue(undefined);
    mockClient = { query, insert } as unknown as ClickHouseClient;
  });

  describe("when a query runs", () => {
    it("sends a query id the application chose", async () => {
      const wrapper = createResilientClickHouseClient({ client: mockClient });
      await wrapper.query({ query: "SELECT 1" } as any);

      const sent = query.mock.calls[0]?.[0] as { query_id?: string };
      expect(sent.query_id).toEqual(expect.any(String));
      expect(sent.query_id).not.toHaveLength(0);
    });

    it("leaves the rest of the caller's parameters untouched", async () => {
      const wrapper = createResilientClickHouseClient({ client: mockClient });
      await wrapper.query({
        query: "SELECT 1",
        format: "JSONEachRow",
        query_params: { tenantId: "t-1" },
      } as any);

      const sent = query.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(sent.query).toBe("SELECT 1");
      expect(sent.format).toBe("JSONEachRow");
      expect(sent.query_params).toEqual({ tenantId: "t-1" });
    });

    it("gives two queries different ids", async () => {
      const wrapper = createResilientClickHouseClient({ client: mockClient });
      await wrapper.query({ query: "SELECT 1" } as any);
      await wrapper.query({ query: "SELECT 2" } as any);

      const first = (query.mock.calls[0]?.[0] as { query_id: string }).query_id;
      const second = (query.mock.calls[1]?.[0] as { query_id: string })
        .query_id;
      expect(first).not.toBe(second);
    });
  });

  describe("when the caller supplied its own query id", () => {
    it("keeps it rather than overwriting it", async () => {
      const wrapper = createResilientClickHouseClient({ client: mockClient });
      await wrapper.query({ query: "SELECT 1", query_id: "mine-1" } as any);

      const sent = query.mock.calls[0]?.[0] as { query_id: string };
      expect(sent.query_id).toBe("mine-1");
    });
  });

  describe("when an insert runs", () => {
    it("sends a query id too", async () => {
      const wrapper = createResilientClickHouseClient({ client: mockClient });
      await wrapper.insert({ table: "traces", values: [] } as any);

      const sent = insert.mock.calls[0]?.[0] as {
        query_id?: string;
        table: string;
      };
      expect(sent.query_id).toEqual(expect.any(String));
      expect(sent.table).toBe("traces");
    });
  });

  describe("when a query fails", () => {
    it("still surfaces the failure to the caller", async () => {
      const boom = new Error("Code: 62. Syntax error");
      query.mockRejectedValue(boom);
      const wrapper = createResilientClickHouseClient({ client: mockClient });

      await expect(wrapper.query({ query: "SELEKT 1" } as any)).rejects.toThrow(
        /Syntax error/,
      );
    });
  });

  describe("when a transient failure is retried", () => {
    it("reuses the same query id across attempts", async () => {
      query
        .mockRejectedValueOnce(new Error("Too many simultaneous queries"))
        .mockResolvedValue({ response_headers: {} });
      const wrapper = createResilientClickHouseClient({
        client: mockClient,
        baseDelayMs: 1,
        maxDelayMs: 2,
      });

      await wrapper.query({ query: "SELECT 1" } as any);

      expect(query).toHaveBeenCalledTimes(2);
      const first = (query.mock.calls[0]?.[0] as { query_id: string }).query_id;
      const second = (query.mock.calls[1]?.[0] as { query_id: string })
        .query_id;
      expect(second).toBe(first);
    });
  });
});
