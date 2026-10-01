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

import { reconcileTTL, TIERED_STORAGE_POLICY } from "../ttl.reconciler.ts";

describe("reconcileTTL()", () => {
  let coldStorageEnabled: boolean;

  beforeEach(() => {
    vi.clearAllMocks();
    // These regressions cover the tiered-storage path (cold + retention TTL),
    // which only emits the cold MOVE clause when the operator has explicitly
    // enabled it. Force the flag on so the assertions about cold TTL still hit.
    coldStorageEnabled = true;
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
      await reconcileTTL({ connectionUrl: "http://localhost:8123/default", coldStorageEnabled });

      expect(clickhouseMocks.client.command).toHaveBeenCalledWith({
        query: expect.stringContaining("toDateTime(EndTime) + INTERVAL 49 DAY TO VOLUME 'cold'"),
      });
      expect(clickhouseMocks.client.command).toHaveBeenCalledWith({
        query: expect.stringContaining("_retention_days"),
      });
    });
  });

  describe("when a managed tiered table already has both cold-storage AND retention TTL", () => {
    /**
     * Reconciler had a bug: it only emitted retention TTL when missing, so a
     * hot-days bump rewrote the cold TTL without it — MODIFY TTL replaces
     * the whole expression atomically, silently dropping the DELETE clause.
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
      await reconcileTTL({
        connectionUrl: "http://localhost:8123/default",
        coldStorageEnabled,
        hotDayOverrides: { CLICKHOUSE_COLD_STORAGE_SPANS_TTL_DAYS: "30" },
      });

      const calls = clickhouseMocks.client.command.mock.calls;
      const modifyTtlCall = calls.find((c) => /MODIFY TTL/.test((c[0] as { query: string }).query));
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
     * Regression: the reconciler used to early-return when
     * CLICKHOUSE_COLD_STORAGE_ENABLED was unset, silently never installing
     * the DELETE TTL. Retention must reconcile independent of that flag.
     */
    it("still installs the retention DELETE TTL even without cold-storage MOVE", async () => {
      coldStorageEnabled = false;

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

      await reconcileTTL({ connectionUrl: "http://localhost:8123/default", coldStorageEnabled });

      const modifyCalls = clickhouseMocks.client.command.mock.calls.filter((c) =>
        /MODIFY TTL/.test((c[0] as { query: string }).query),
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

  describe("when a managed table already has retention TTL normalized by ClickHouse", () => {
    /**
     * Regression: hasRetentionTTL() matched on literal "DELETE", but
     * ClickHouse strips that keyword from a normalized TTL — a false
     * negative that re-issued ALTER MODIFY TTL on every migrate run.
     */
    it("does not re-issue the ALTER (recognizes the TTL despite no DELETE keyword)", async () => {
      // engine_full exactly as ClickHouse stores it after our retention ALTER:
      // the `if(...)` retention expression, on a non-tiered policy, WITHOUT the
      // implicit DELETE keyword.
      clickhouseMocks.client.query.mockResolvedValueOnce({
        json: async () => [
          {
            name: "stored_spans",
            storage_policy: "default",
            engine_full:
              "ReplicatedReplacingMergeTree ORDER BY (TenantId) TTL " +
              "if(_retention_days > 0, " +
              "toDateTime(StartTime) + toIntervalDay(_retention_days), " +
              "toDateTime('2106-01-01'))",
          },
        ],
      });

      await reconcileTTL({ connectionUrl: "http://localhost:8123/default", coldStorageEnabled });

      const modifyCalls = clickhouseMocks.client.command.mock.calls.filter((c) =>
        /MODIFY TTL/.test((c[0] as { query: string }).query),
      );
      expect(modifyCalls).toHaveLength(0);
    });
  });

  describe("when CLICKHOUSE_CLUSTER is set (Replicated database)", () => {
    /**
     * A Replicated database (enforced in goose.ts) auto-replicates DDL via
     * Keeper, so ClickHouse rejects `ON CLUSTER` on its tables outright
     * ("INCORRECT_QUERY"). The emitted ALTER must therefore carry no ON CLUSTER.
     */
    it("issues the ALTER without an ON CLUSTER clause", async () => {
      await reconcileTTL({
        connectionUrl: "http://localhost:8123/default",
        coldStorageEnabled,
        clusterName: "main",
      });

      const modifyCalls = clickhouseMocks.client.command.mock.calls.filter((c) =>
        /MODIFY TTL/.test((c[0] as { query: string }).query),
      );
      expect(modifyCalls.length).toBeGreaterThan(0);
      for (const call of modifyCalls) {
        expect((call[0] as { query: string }).query).not.toContain("ON CLUSTER");
      }
    });
  });
});
