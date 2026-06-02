import { describe, it, expect } from "vitest";
import {
  buildRetentionTTLExpression,
  hasRetentionTTL,
  TABLE_TTL_CONFIG,
} from "../ttlReconciler";
import { RETENTION_MANAGED_TABLES } from "../../data-retention/retentionPolicy.schema";

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
      const config = TABLE_TTL_CONFIG.find((c) => c.table === "evaluation_runs")!;
      expect(config.retentionTTLColumn).toBe("UpdatedAt");
      const expr = buildRetentionTTLExpression(config);
      expect(expr).toBe(
        "IF(_retention_days > 0, toDateTime(UpdatedAt) + toIntervalDay(_retention_days), toDateTime('2106-01-01')) DELETE",
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
      'ReplacingMergeTree(UpdatedAt) TTL toDateTime(OccurredAt) + toIntervalDay(49) TO VOLUME \'cold\', IF(_retention_days > 0, ...) DELETE';
    expect(hasRetentionTTL(engineFull)).toBe(true);
  });

  it("returns false when no retention TTL", () => {
    const engineFull =
      "ReplacingMergeTree(UpdatedAt) TTL toDateTime(OccurredAt) + toIntervalDay(49) TO VOLUME 'cold'";
    expect(hasRetentionTTL(engineFull)).toBe(false);
  });
});

describe("RETENTION_MANAGED_TABLES", () => {
  it("includes all 11 retention-managed tables", () => {
    expect(RETENTION_MANAGED_TABLES).toHaveLength(11);
    expect(RETENTION_MANAGED_TABLES).toContain("stored_spans");
    expect(RETENTION_MANAGED_TABLES).toContain("event_log");
    expect(RETENTION_MANAGED_TABLES).toContain("trace_summaries");
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
