import { describe, expect, it } from "vitest";
import { RETENTION_MANAGED_TABLES } from "../../retentionPolicy.schema";
import {
  BILLABLE_AFTER_DAYS,
  BILLABLE_AGE_EXPR_BY_TABLE,
  buildBillableStorageQuery,
} from "../billableStorageQuery";

describe("buildBillableStorageQuery", () => {
  const sql = buildBillableStorageQuery(BILLABLE_AGE_EXPR_BY_TABLE);

  describe("given the managed-table age-expression map", () => {
    /** @scenario Each table is aged by its retention/TTL column, so the measurement matches what TTL deletes */
    it("covers exactly the retention-managed tables", () => {
      expect(Object.keys(BILLABLE_AGE_EXPR_BY_TABLE).sort()).toEqual(
        [...RETENTION_MANAGED_TABLES].sort(),
      );
    });

    it("excludes billable_events (no retention TTL column)", () => {
      expect(BILLABLE_AGE_EXPR_BY_TABLE).not.toHaveProperty("billable_events");
    });
  });

  describe("when building the per-tenant SQL", () => {
    it("pre-aggregates each table to a scalar before the outer sum", () => {
      // One sum(_size_bytes) per managed table, all wrapped in an outer sum(t).
      expect(sql).toMatch(/SELECT sum\(t\) AS total FROM \(/);
      const perTable = sql.match(/sum\(_size_bytes\) AS t FROM/g) ?? [];
      expect(perTable.length).toBe(RETENTION_MANAGED_TABLES.length);
    });

    it("scopes every subquery by the tenant id parameter", () => {
      const scoped = sql.match(/WHERE TenantId = \{tenantId:String\}/g) ?? [];
      expect(scoped.length).toBe(RETENTION_MANAGED_TABLES.length);
    });

    /** @scenario Data older than the free window is billable */
    /** @scenario Data inside the free window is free */
    it("ages every subquery against the UTC cutoff parameter", () => {
      const aged = sql.match(/<= \{cutoff:DateTime\('UTC'\)\}/g) ?? [];
      expect(aged.length).toBe(RETENTION_MANAGED_TABLES.length);
    });

    it("never issues a cross-tenant IN scan", () => {
      expect(sql).not.toMatch(/TenantId IN/i);
      expect(sql).not.toContain("IN (");
    });

    /** @scenario The query filters only on the retention column, never on an assumed partition key */
    /** @scenario evaluation_runs bills on time-since-last-update, a documented limitation */
    it("ages evaluation_runs on UpdatedAt and never synthesizes a ScheduledAt predicate", () => {
      expect(BILLABLE_AGE_EXPR_BY_TABLE.evaluation_runs).toBe(
        "toDateTime(UpdatedAt)",
      );
      const evalSub = sql
        .split("UNION ALL")
        .find((part) => part.includes("FROM evaluation_runs"))!;
      expect(evalSub).toContain("toDateTime(UpdatedAt) <=");
      expect(evalSub).not.toContain("ScheduledAt");
    });

    /** @scenario The age comparison is byte-identical to the TTL delete expression */
    it("ages event_log on the epoch-millis conversion sourced from the retention config", () => {
      expect(BILLABLE_AGE_EXPR_BY_TABLE.event_log).toBe(
        "toDateTime(EventOccurredAt / 1000)",
      );
      const eventSub = sql
        .split("UNION ALL")
        .find((part) => part.includes("FROM event_log"))!;
      expect(eventSub).toContain("toDateTime(EventOccurredAt / 1000) <=");
    });
  });

  describe("given the free-window constant", () => {
    it("is 35 days (5 weeks, a clean toYearWeek partition boundary)", () => {
      expect(BILLABLE_AFTER_DAYS).toBe(35);
      expect(BILLABLE_AFTER_DAYS % 7).toBe(0);
    });
  });
});
