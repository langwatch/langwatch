import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clickhouseMocks = vi.hoisted(() => {
  const client = {
    query: vi.fn(),
    command: vi.fn(),
  };
  return { client };
});

vi.mock("~/server/app-layer/clients/clickhouse/shared", () => ({
  getInfrastructureClickHouseClient: () => clickhouseMocks.client,
  getSharedAppClickHouseClient: () => ({
    resolveClient: () => clickhouseMocks.client,
  }),
}));

import { reconcileTTL, TIERED_STORAGE_POLICY } from "../ttlReconciler";

/** The url both the reconciler and its caller treat as the shared endpoint. */
const SHARED_URL = "http://localhost:8123/default";

/**
 * `system.tables` as the client returns it: positional cells plus the header
 * the seam decodes them by.
 */
function tablesResult(
  rows: Array<{ name: string; engine_full: string; storage_policy: string }>,
) {
  return {
    rows: rows.map((r) => [r.name, r.engine_full, r.storage_policy]),
    header: {
      names: ["name", "engine_full", "storage_policy"],
      types: ["String", "String", "String"],
    },
  };
}

/** Every ALTER the run issued, as SQL text. */
function issuedSql(): string[] {
  return clickhouseMocks.client.command.mock.calls.map(
    (call) => (call[0] as { sql: string }).sql,
  );
}

describe("reconcileTTL()", () => {
  const envBackup = {
    CLICKHOUSE_COLD_STORAGE_ENABLED:
      process.env.CLICKHOUSE_COLD_STORAGE_ENABLED,
    CLICKHOUSE_URL: process.env.CLICKHOUSE_URL,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // These regressions cover the tiered-storage path (cold + retention TTL),
    // which only emits the cold MOVE clause when the operator has explicitly
    // enabled it. Force the flag on so the assertions about cold TTL still hit.
    process.env.CLICKHOUSE_COLD_STORAGE_ENABLED = "true";
    // The reconciler resolves its endpoint through the deployment's own client,
    // so the url under test has to be one the deployment declares.
    process.env.CLICKHOUSE_URL = SHARED_URL;
    clickhouseMocks.client.query.mockResolvedValue(
      tablesResult([
        {
          name: "stored_spans",
          storage_policy: TIERED_STORAGE_POLICY,
          engine_full:
            "MergeTree ORDER BY (TenantId) TTL toDateTime(EndTime) + toIntervalDay(49) TO VOLUME 'cold'",
        },
      ]),
    );
    clickhouseMocks.client.command.mockResolvedValue(undefined);
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(envBackup)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  describe("when a tiered table has current cold-storage TTL but no retention TTL", () => {
    /** @scenario Existing tiered tables receive missing retention TTL */
    it("adds the retention TTL without removing cold-storage TTL", async () => {
      await reconcileTTL({ connectionUrl: SHARED_URL });

      const sql = issuedSql();
      expect(
        sql.some((s) =>
          s.includes("toDateTime(EndTime) + INTERVAL 49 DAY TO VOLUME 'cold'"),
        ),
      ).toBe(true);
      expect(sql.some((s) => s.includes("_retention_days"))).toBe(true);
      // The statement-level SETTINGS clause is what makes the ALTER
      // metadata-only, and it must ride inside the SQL rather than as a
      // request setting.
      expect(
        sql.every((s) =>
          s.includes("SETTINGS materialize_ttl_after_modify = 0"),
        ),
      ).toBe(true);
      for (const call of clickhouseMocks.client.command.mock.calls) {
        expect((call[0] as { settings?: unknown }).settings).toBeUndefined();
      }
    });
  });

  describe("when a managed tiered table already has both cold-storage AND retention TTL", () => {
    /**
     * Reconciler had a bug where it only emitted retention TTL when the table
     * was missing it. On a hot-days bump, the cold TTL was rewritten without
     * the retention clause — MODIFY TTL replaces the whole expression
     * atomically, so the retention DELETE was silently dropped.
     */
    /** @scenario "Retention TTL coexists with cold-storage tiering" */
    it("preserves the retention TTL when the cold TTL is rewritten", async () => {
      // Table already has both: cold TO VOLUME + retention DELETE on _retention_days
      clickhouseMocks.client.query.mockResolvedValueOnce(
        tablesResult([
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
        ]),
      );

      // Operator bumps hot-days for stored_spans from 49 to 30 via env var
      const originalEnv = process.env.CLICKHOUSE_COLD_STORAGE_SPANS_TTL_DAYS;
      process.env.CLICKHOUSE_COLD_STORAGE_SPANS_TTL_DAYS = "30";
      try {
        await reconcileTTL({ connectionUrl: SHARED_URL });
      } finally {
        if (originalEnv === undefined) {
          delete process.env.CLICKHOUSE_COLD_STORAGE_SPANS_TTL_DAYS;
        } else {
          process.env.CLICKHOUSE_COLD_STORAGE_SPANS_TTL_DAYS = originalEnv;
        }
      }

      const modifyTtlSql = issuedSql().find((s) => /MODIFY TTL/.test(s));
      expect(modifyTtlSql).toBeDefined();

      // Must contain the new cold-storage TTL (30 days)
      expect(modifyTtlSql).toContain("INTERVAL 30 DAY TO VOLUME 'cold'");
      // And MUST still contain the retention DELETE clause
      expect(modifyTtlSql).toContain("_retention_days");
      expect(modifyTtlSql).toContain("DELETE");
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
      clickhouseMocks.client.query.mockResolvedValueOnce(
        tablesResult([
          {
            name: "stored_spans",
            storage_policy: TIERED_STORAGE_POLICY,
            engine_full:
              "MergeTree ORDER BY (TenantId) TTL toDateTime(EndTime) + toIntervalDay(49) TO VOLUME 'cold'",
          },
        ]),
      );

      await reconcileTTL({ connectionUrl: SHARED_URL });

      const modifySql = issuedSql().filter((s) => /MODIFY TTL/.test(s));
      expect(modifySql.length).toBeGreaterThan(0);

      // Retention DELETE clause IS issued
      expect(modifySql[0]).toContain("_retention_days");
      expect(modifySql[0]).toContain("DELETE");
      // Cold MOVE clause is NOT issued — the operator hasn't opted in
      expect(modifySql[0]).not.toContain("TO VOLUME 'cold'");
    });
  });

  describe("when a managed table already has retention TTL normalized by ClickHouse", () => {
    /**
     * Regression: hasRetentionTTL() matched on the literal "DELETE" keyword, but
     * ClickHouse normalizes a bare-DateTime TTL to an implicit DELETE and strips
     * the keyword from stored metadata (engine_full). The check was a permanent
     * false-negative, so the reconciler re-issued ALTER MODIFY TTL for every
     * managed table on every migrate run instead of recognizing the TTL was
     * already installed. Reconciliation must be idempotent.
     */
    it("does not re-issue the ALTER (recognizes the TTL despite no DELETE keyword)", async () => {
      // engine_full exactly as ClickHouse stores it after our retention ALTER:
      // the `if(...)` retention expression, on a non-tiered policy, WITHOUT the
      // implicit DELETE keyword.
      clickhouseMocks.client.query.mockResolvedValueOnce(
        tablesResult([
          {
            name: "stored_spans",
            storage_policy: "default",
            engine_full:
              "ReplicatedReplacingMergeTree ORDER BY (TenantId) TTL " +
              "if(_retention_days > 0, " +
              "toDateTime(StartTime) + toIntervalDay(_retention_days), " +
              "toDateTime('2106-01-01'))",
          },
        ]),
      );

      await reconcileTTL({ connectionUrl: SHARED_URL });

      expect(issuedSql().filter((s) => /MODIFY TTL/.test(s))).toHaveLength(0);
    });
  });

  describe("when CLICKHOUSE_CLUSTER is set (Replicated database)", () => {
    /**
     * Regression: the reconciler appended `ON CLUSTER <name>` whenever a cluster
     * was configured. But a configured cluster always means the database uses the
     * Replicated engine (enforced in goose.ts), which auto-replicates DDL to every
     * replica via Keeper. ClickHouse rejects ON CLUSTER on a table inside a
     * Replicated DB with "It's not initial query. ON CLUSTER is not allowed for
     * Replicated database (INCORRECT_QUERY)", crashing clickhouseMigrate on every
     * run against the cluster. The emitted ALTER must therefore carry no ON CLUSTER.
     */
    it("issues the ALTER without an ON CLUSTER clause", async () => {
      const originalCluster = process.env.CLICKHOUSE_CLUSTER;
      process.env.CLICKHOUSE_CLUSTER = "main";
      try {
        await reconcileTTL({ connectionUrl: SHARED_URL });
      } finally {
        if (originalCluster === undefined) {
          delete process.env.CLICKHOUSE_CLUSTER;
        } else {
          process.env.CLICKHOUSE_CLUSTER = originalCluster;
        }
      }

      const modifySql = issuedSql().filter((s) => /MODIFY TTL/.test(s));
      expect(modifySql.length).toBeGreaterThan(0);
      for (const sql of modifySql) {
        expect(sql).not.toContain("ON CLUSTER");
      }
    });
  });
});
