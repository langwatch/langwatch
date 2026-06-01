import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  const envBackup = { CLICKHOUSE_COLD_STORAGE_ENABLED: process.env.CLICKHOUSE_COLD_STORAGE_ENABLED };

  beforeEach(() => {
    vi.clearAllMocks();
    // These regressions cover the tiered-storage path (cold + retention TTL),
    // which only emits the cold MOVE clause when the operator has explicitly
    // enabled it. Force the flag on so the assertions about cold TTL still hit.
    process.env.CLICKHOUSE_COLD_STORAGE_ENABLED = "true";
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

  afterEach(() => {
    if (envBackup.CLICKHOUSE_COLD_STORAGE_ENABLED === undefined) {
      delete process.env.CLICKHOUSE_COLD_STORAGE_ENABLED;
    } else {
      process.env.CLICKHOUSE_COLD_STORAGE_ENABLED = envBackup.CLICKHOUSE_COLD_STORAGE_ENABLED;
    }
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

  describe("when cold storage is disabled on the deployment", () => {
    /**
     * Regression: the reconciler used to early-return whenever
     * CLICKHOUSE_COLD_STORAGE_ENABLED was unset, so self-hosted/default-storage
     * installs stamped `_retention_days` but never installed the DELETE TTL,
     * silently failing to enforce retention. Retention TTL must reconcile
     * independently of the cold-storage flag.
     */
    it("still installs the retention DELETE TTL even without cold-storage MOVE", async () => {
      delete process.env.CLICKHOUSE_COLD_STORAGE_ENABLED;

      // Table currently has no retention TTL at all, even though it's on the
      // tiered policy. Without cold-storage management we should still install
      // retention.
      clickhouseMocks.client.query.mockResolvedValueOnce({
        json: async () => [
          {
            name: "stored_spans",
            storage_policy: TIERED_STORAGE_POLICY,
            engine_full:
              "MergeTree ORDER BY (TenantId) TTL toDateTime(EndTime) + toIntervalDay(49) TO VOLUME 'cold'",
          },
        ],
      });

      await reconcileTTL({ connectionUrl: "http://localhost:8123/default" });

      const modifyCalls = clickhouseMocks.client.command.mock.calls.filter(
        (c) => /MODIFY TTL/.test((c[0] as { query: string }).query),
      );
      expect(modifyCalls.length).toBeGreaterThan(0);
      const query = (modifyCalls[0]![0] as { query: string }).query;

      // Retention DELETE clause IS issued
      expect(query).toContain("_retention_days");
      expect(query).toContain("DELETE");
      // Cold MOVE clause is NOT issued — the operator hasn't opted in
      expect(query).not.toContain("TO VOLUME 'cold'");
    });
  });
});
