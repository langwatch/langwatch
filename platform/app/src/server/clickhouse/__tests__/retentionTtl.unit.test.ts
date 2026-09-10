import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  INDEFINITE_DEFAULT_RETENTION_TABLES,
  PRODUCTION_STORAGE_METER_TABLES,
  RETENTION_MANAGED_TABLES,
  RETENTION_TABLE_CATEGORY_MAP,
  RETENTION_TTL_MANAGED_TABLES,
} from "../../data-retention/retentionPolicy.schema";
import {
  buildRetentionTTLExpression,
  hasRetentionTTL,
  TABLE_TTL_CONFIG,
} from "../ttlReconciler";

const MIGRATIONS_DIR = join(process.cwd(), "src/server/clickhouse/migrations");

/**
 * Migration numbers move whenever a branch rebases past someone else's, so
 * these assertions match on the descriptive half of the filename instead.
 */
const migrationEndingIn = (suffix: string): string => {
  const matches = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(suffix));
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one migration ending in ${suffix}, found ${matches.length}`,
    );
  }
  return join(MIGRATIONS_DIR, matches[0]!);
};

describe("buildRetentionTTLExpression", () => {
  // The IF(_retention_days > 0, ...) guard is a safety net, not a normal path:
  // every row carries a finite retention (308 migration default for pre-column
  // rows, 49+ for new inserts), so 0 should never occur. But the guard MUST
  // stay — without it a stray 0 evaluates to anchor + toIntervalDay(0) = the
  // anchor date (in the past) and the row is deleted on the next merge. The
  // guard maps 0 to the far-future 2106-01-01 sentinel instead.
  describe("when retentionTTLColumn is set", () => {
    it("builds correct IF expression for DateTime columns", () => {
      const config = TABLE_TTL_CONFIG.find((c) => c.table === "stored_spans")!;
      const expr = buildRetentionTTLExpression(config);
      expect(expr).toBe(
        "IF(_retention_days > 0, toDateTime(StartTime) + toIntervalDay(_retention_days), toDateTime('2106-01-01')) DELETE",
      );
    });

    it("uses custom expression for event_log UInt64 column", () => {
      const config = TABLE_TTL_CONFIG.find((c) => c.table === "event_log")!;
      const expr = buildRetentionTTLExpression(config);
      expect(expr).toBe(
        "IF(_retention_days > 0, toDateTime(EventOccurredAt / 1000) + toIntervalDay(_retention_days), toDateTime('2106-01-01')) DELETE",
      );
    });

    // Regression: ScheduledAt and StartedAt on evaluation_runs are both
    // Nullable(DateTime64(3)), which CH rejects in TTL expressions with
    // BAD_TTL_EXPRESSION (code 450). The anchor must be UpdatedAt — non-null
    // and partition-aligned with `toYearWeek(UpdatedAt)`.
    it("evaluation_runs anchors retention on the non-null partition key", () => {
      const config = TABLE_TTL_CONFIG.find(
        (c) => c.table === "evaluation_runs",
      )!;
      expect(config.retentionTTLColumn).toBe("UpdatedAt");
      const expr = buildRetentionTTLExpression(config);
      expect(expr).toBe(
        "IF(_retention_days > 0, toDateTime(UpdatedAt) + toIntervalDay(_retention_days), toDateTime('2106-01-01')) DELETE",
      );
    });

    it("Langy analytics anchors retention on its immutable event time", () => {
      const config = TABLE_TTL_CONFIG.find(
        (entry) => entry.table === "langy_analytics_events",
      )!;
      expect(config.retentionTTLColumn).toBe("OccurredAt");
      expect(buildRetentionTTLExpression(config)).toBe(
        "IF(_retention_days > 0, toDateTime(OccurredAt) + toIntervalDay(_retention_days), toDateTime('2106-01-01')) DELETE",
      );
    });
  });

  describe("when retentionTTLColumn is not set", () => {
    it("returns null for billable_events", () => {
      const config = TABLE_TTL_CONFIG.find(
        (c) => c.table === "billable_events",
      )!;
      const expr = buildRetentionTTLExpression(config);
      expect(expr).toBeNull();
    });
  });
});

describe("hasRetentionTTL", () => {
  it("detects retention TTL in engine metadata", () => {
    const engineFull =
      "ReplacingMergeTree(UpdatedAt) TTL toDateTime(OccurredAt) + toIntervalDay(49) TO VOLUME 'cold', IF(_retention_days > 0, ...) DELETE";
    expect(hasRetentionTTL(engineFull)).toBe(true);
  });

  it("returns false when no retention TTL", () => {
    const engineFull =
      "ReplacingMergeTree(UpdatedAt) TTL toDateTime(OccurredAt) + toIntervalDay(49) TO VOLUME 'cold'";
    expect(hasRetentionTTL(engineFull)).toBe(false);
  });
});

describe("RETENTION_MANAGED_TABLES", () => {
  it("includes all 19 retention-managed tables", () => {
    expect(RETENTION_MANAGED_TABLES).toHaveLength(19);
    expect(RETENTION_MANAGED_TABLES).toContain("stored_spans");
    expect(RETENTION_MANAGED_TABLES).toContain("event_log");
    expect(RETENTION_MANAGED_TABLES).toContain("trace_summaries");
    expect(RETENTION_MANAGED_TABLES).toContain("metric_data_points");
    expect(RETENTION_MANAGED_TABLES).toContain("log_records");
    expect(RETENTION_MANAGED_TABLES).toContain("metric_series");
    expect(RETENTION_MANAGED_TABLES).toContain("metric_time_rollups");
    expect(RETENTION_MANAGED_TABLES).not.toContain("stored_metric_records");
    // ADR-034 Phase 2 (slim) + Phase 1 (rollup) — both derive from trace events
    // and age on the same per-project retention policy as trace_summaries.
    expect(RETENTION_MANAGED_TABLES).toContain("trace_analytics");
    expect(RETENTION_MANAGED_TABLES).toContain("trace_analytics_rollup");
    // ADR-034 Phase 6 — eval mirrors; age with the eval-pipeline retention
    // (currently categorised "traces" until eval split-out lands).
    expect(RETENTION_MANAGED_TABLES).toContain("evaluation_analytics");
    expect(RETENTION_MANAGED_TABLES).toContain("evaluation_analytics_rollup");
    expect(RETENTION_MANAGED_TABLES).toContain("langy_analytics_events");
    expect(RETENTION_MANAGED_TABLES).toContain("simulation_runs");
    expect(RETENTION_MANAGED_TABLES).toContain("suite_runs");
    expect(RETENTION_MANAGED_TABLES).toContain("experiment_runs");
    expect(RETENTION_MANAGED_TABLES).toContain("experiment_run_items");
    expect(RETENTION_MANAGED_TABLES).toContain("dspy_steps");
  });

  it("does not include billable_events", () => {
    expect(RETENTION_MANAGED_TABLES).not.toContain("billable_events");
  });

  it("all retention tables have retentionTTLColumn configured", () => {
    for (const table of RETENTION_MANAGED_TABLES) {
      const config = TABLE_TTL_CONFIG.find((c) => c.table === table);
      expect(config, `${table} missing from TABLE_TTL_CONFIG`).toBeDefined();
      expect(
        config!.retentionTTLColumn,
        `${table} missing retentionTTLColumn`,
      ).toBeDefined();
    }
  });
});

describe("gateway_spend retention exemption", () => {
  // Billing records must never be governed by tenant retention: policies are
  // customer-shrinkable to weeks and retroactively rewrite _retention_days
  // across every mapped table. The spend table follows the usage-estimate
  // ledgers instead: a fixed 13-month TTL declared in its own migration, and
  // total absence from the reconciler config so MODIFY TTL never rewrites
  // that clause. If either assertion here fails, someone has wired billing
  // data into tenant retention and a 35-day tenant policy would start
  // hard-deleting invoiceable rows.
  /** @scenario Billing records are exempt from tenant retention and keep a fixed thirteen month window */
  it("is absent from tenant retention and from the TTL reconciler config", () => {
    expect(RETENTION_MANAGED_TABLES).not.toContain("gateway_spend");
    expect(
      TABLE_TTL_CONFIG.find((c) => c.table === "gateway_spend"),
    ).toBeUndefined();
  });

  it("declares its fixed 13-month delete in the migration itself", () => {
    const migration = readFileSync(
      join(
        process.cwd(),
        "src/server/clickhouse/migrations/00067_create_gateway_spend.sql",
      ),
      "utf8",
    );
    expect(migration).toContain(
      "TTL toDateTime(OccurredAt) + INTERVAL 13 MONTH DELETE",
    );
    expect(migration).not.toContain("_retention_days");
  });
});

describe("governance cost tables keep data indefinitely by default", () => {
  // These two tables used to be exempt from retention the way `gateway_spend`
  // still is: a fixed 13-month DELETE hardcoded in their own migration and no
  // entry in either reconciler map. That reasoning was "a customer policy must
  // never hard-delete a cost record" — true, and the fixed timer was a blunt
  // way to guarantee it, because it also hard-deleted the record itself after
  // thirteen months with no way to keep it, shorten it, or ask the question
  // per tenant.
  //
  // Migration 00095 replaces the timer with the `_retention_days` column,
  // DEFAULTING TO 0. Zero is the indefinite sentinel, so the default answer is
  // now "keep forever" and a row is deleted only if a day count is deliberately
  // stamped on it. The original guarantee survives by a different route: these
  // tables stay OUT of RETENTION_TABLE_CATEGORY_MAP, so no customer-facing
  // retention policy can reach them (and they stay out of the storage meter,
  // which the same map drives). They are in the separate
  // INDEFINITE_DEFAULT_RETENTION_TABLES list, and the reconciler gates on the
  // union of the two.
  //
  // If the "not in RETENTION_MANAGED_TABLES" assertions below fail, someone has
  // wired money records into the customer retention cascade, where
  // `resolveRetention` would floor them to 49 days and start deleting.
  const GOVERNANCE_COST_TABLES = [
    "governance_cost_rollup_1d",
    "governance_cost_rollup_restatement_index",
  ] as const;

  it.each(
    GOVERNANCE_COST_TABLES,
  )("%s is in the TTL reconciler config", (table) => {
    expect(TABLE_TTL_CONFIG.find((c) => c.table === table)).toBeDefined();
  });

  it.each(
    GOVERNANCE_COST_TABLES,
  )("%s is outside the customer retention cascade and the storage meter", (table) => {
    expect(RETENTION_MANAGED_TABLES).not.toContain(table);
    expect(RETENTION_TABLE_CATEGORY_MAP).not.toHaveProperty(table);
    expect(PRODUCTION_STORAGE_METER_TABLES).not.toContain(table);
  });

  it.each(
    GOVERNANCE_COST_TABLES,
  )("%s is in the indefinite-default list and therefore in the reconciler's gate", (table) => {
    expect(INDEFINITE_DEFAULT_RETENTION_TABLES).toContain(table);
    expect(RETENTION_TTL_MANAGED_TABLES).toContain(table);
  });

  // The gate must be a strict superset, not a replacement: widening it must not
  // have dropped any customer-managed table on the way through.
  it("the reconciler gate is the customer set plus the indefinite-default set", () => {
    for (const table of RETENTION_MANAGED_TABLES) {
      expect(RETENTION_TTL_MANAGED_TABLES).toContain(table);
    }
    expect(RETENTION_TTL_MANAGED_TABLES).toHaveLength(
      RETENTION_MANAGED_TABLES.length +
        INDEFINITE_DEFAULT_RETENTION_TABLES.length,
    );
  });

  it.each(
    GOVERNANCE_COST_TABLES,
  )("%s anchors its retention TTL on Day, with the indefinite sentinel", (table) => {
    const config = TABLE_TTL_CONFIG.find((c) => c.table === table)!;
    const expr = buildRetentionTTLExpression(config);
    expect(expr).toBe(
      "IF(_retention_days > 0, toDateTime(Day) + toIntervalDay(_retention_days), toDateTime('2106-01-01')) DELETE",
    );
    // `hasRetentionTTL` matches on this substring, so it is what stops the
    // reconciler re-issuing MODIFY TTL on every boot.
    expect(hasRetentionTTL(expr!)).toBe(true);
  });

  describe("when the migration that installs the column is read", () => {
    /**
     * Only the statements the migration actually RUNS. Every comment line —
     * including the house-style commented-out `down` block, which still names
     * the old 13-month timer — starts with `--`, and so do goose's own
     * directives, so dropping them leaves the executed SQL alone. If this
     * filter ever emptied, the `MODIFY TTL` count below would read 0 and fail
     * rather than pass vacuously.
     */
    const executedSql = (): string =>
      readFileSync(
        migrationEndingIn("_governance_cost_rollup_retention_days.sql"),
        "utf8",
      )
        .split("\n")
        .filter(
          (line) => line.trim() !== "" && !line.trimStart().startsWith("--"),
        )
        .join("\n");

    it.each(
      GOVERNANCE_COST_TABLES,
    )("adds _retention_days to %s with DEFAULT 0, the keep-forever sentinel", (table) => {
      expect(executedSql()).toContain(
        `ALTER TABLE \${CLICKHOUSE_DATABASE}.${table}\n` +
          "  ADD COLUMN IF NOT EXISTS `_retention_days` UInt16 DEFAULT 0 CODEC(Delta(2), ZSTD(1))",
      );
    });

    it.each(
      GOVERNANCE_COST_TABLES,
    )("rewrites %s's TTL to the retention expression in the same migration", (table) => {
      expect(executedSql()).toContain(
        `ALTER TABLE \${CLICKHOUSE_DATABASE}.${table}\n` +
          "  MODIFY TTL IF(_retention_days > 0, toDateTime(Day) + toIntervalDay(_retention_days), toDateTime('2106-01-01')) DELETE",
      );
    });

    // The point of the change: after this migration nothing the platform runs
    // installs a fixed timer on these tables. The phrase may survive in the
    // commented-out `down` block; it may not survive anywhere that executes.
    it("leaves no executed statement that reinstalls the 13-month delete", () => {
      const sql = executedSql();
      expect(sql.match(/MODIFY TTL/g) ?? []).toHaveLength(
        GOVERNANCE_COST_TABLES.length,
      );
      expect(sql).not.toContain("INTERVAL 13 MONTH");
    });
  });
});
