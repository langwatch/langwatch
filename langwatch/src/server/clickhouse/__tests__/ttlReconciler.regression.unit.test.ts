import { beforeEach, describe, expect, it, vi } from "vitest";

const clickhouseMocks = vi.hoisted(() => {
  const client = {
    query: vi.fn(),
    command: vi.fn(),
    close: vi.fn(),
  };
  return {
    client,
    createClient: vi.fn(() => client),
  };
});

vi.mock("@clickhouse/client", () => ({
  createClient: clickhouseMocks.createClient,
}));

import { reconcileTTL, TIERED_STORAGE_POLICY } from "../ttlReconciler";

describe("reconcileTTL()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clickhouseMocks.client.query.mockResolvedValue({
      json: async () => [
        {
          name: "stored_spans",
          storage_policy: TIERED_STORAGE_POLICY,
          engine_full:
            "MergeTree ORDER BY (TenantId) TTL toDateTime(EndTime) + toIntervalDay(49) TO VOLUME 'cold'",
        },
      ],
    });
    clickhouseMocks.client.command.mockResolvedValue(undefined);
    clickhouseMocks.client.close.mockResolvedValue(undefined);
  });

  describe("when a tiered table has current cold-storage TTL but no retention TTL", () => {
    /** @scenario Existing tiered tables receive missing retention TTL */
    it("adds the retention TTL without removing cold-storage TTL", async () => {
      await reconcileTTL({ connectionUrl: "http://localhost:8123/default" });

      expect(clickhouseMocks.client.command).toHaveBeenCalledWith({
        query: expect.stringContaining(
          "toDateTime(EndTime) + INTERVAL 49 DAY TO VOLUME 'cold'",
        ),
      });
      expect(clickhouseMocks.client.command).toHaveBeenCalledWith({
        query: expect.stringContaining("_retention_days"),
      });
    });
  });

  describe("when a managed tiered table already has both cold-storage AND retention TTL", () => {
    /**
     * Reconciler had a bug where it only emitted retention TTL when the table
     * was missing it. On a hot-days bump, the cold TTL was rewritten without
     * the retention clause — MODIFY TTL replaces the whole expression
     * atomically, so the retention DELETE was silently dropped.
     */
    it("preserves the retention TTL when the cold TTL is rewritten", async () => {
      // Table already has both: cold TO VOLUME + retention DELETE on _retention_days
      clickhouseMocks.client.query.mockResolvedValueOnce({
        json: async () => [
          {
            name: "stored_spans",
            storage_policy: TIERED_STORAGE_POLICY,
            engine_full:
              "MergeTree ORDER BY (TenantId) TTL " +
              "toDateTime(EndTime) + toIntervalDay(49) TO VOLUME 'cold', " +
              "if(_retention_days > 0, " +
              "toDateTime(EndTime) + toIntervalDay(_retention_days), " +
              "toDateTime('2106-01-01')) DELETE",
          },
        ],
      });

      // Operator bumps hot-days for stored_spans from 49 to 30 via env var
      const originalEnv = process.env.CLICKHOUSE_COLD_STORAGE_SPANS_TTL_DAYS;
      process.env.CLICKHOUSE_COLD_STORAGE_SPANS_TTL_DAYS = "30";
      try {
        await reconcileTTL({ connectionUrl: "http://localhost:8123/default" });
      } finally {
        if (originalEnv === undefined) {
          delete process.env.CLICKHOUSE_COLD_STORAGE_SPANS_TTL_DAYS;
        } else {
          process.env.CLICKHOUSE_COLD_STORAGE_SPANS_TTL_DAYS = originalEnv;
        }
      }

      const calls = clickhouseMocks.client.command.mock.calls;
      const modifyTtlCall = calls.find((c) =>
        /MODIFY TTL/.test((c[0] as { query: string }).query),
      );
      expect(modifyTtlCall).toBeDefined();
      const query = (modifyTtlCall![0] as { query: string }).query;

      // Must contain the new cold-storage TTL (30 days)
      expect(query).toContain("INTERVAL 30 DAY TO VOLUME 'cold'");
      // And MUST still contain the retention DELETE clause
      expect(query).toContain("_retention_days");
      expect(query).toContain("DELETE");
    });
  });
});
