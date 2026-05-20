import { describe, it, expect } from "vitest";
import {
  buildRetentionTTLExpression,
  hasRetentionTTL,
  TABLE_TTL_CONFIG,
} from "../ttlReconciler";
import { RETENTION_MANAGED_TABLES } from "../../data-retention/retentionPolicy.schema";

describe("buildRetentionTTLExpression", () => {
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
