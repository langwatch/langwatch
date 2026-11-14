/**
 * ADR-202, "Tables are typed descriptors": each table trace owns reads under the scope it is
 * built with, and its tenant setting names exactly that scope's tenants.
 */
import { clickhouseRead, tenantScope } from "@langwatch/clickhouse-client/builder";
import { describe, expect, it } from "vitest";

import { spanAnalytics } from "../clickhouse.span-analytics.table.ts";
import { storedSpans } from "../clickhouse.stored-spans.table.ts";
import { traceAnalyticsRollup } from "../clickhouse.trace-analytics-rollup.table.ts";
import { traceAnalytics } from "../clickhouse.trace-analytics.table.ts";
import { traceEvaluationAnalytics } from "../clickhouse.trace-evaluation-analytics.table.ts";
import { traceSummaries } from "../clickhouse.trace-summaries.table.ts";

const TENANT_SETTING = "SQL_langwatch_tenant_ids";

describe("trace's ClickHouse table descriptors", () => {
  describe("when a deduplicated table is read for one tenant", () => {
    it.each([
      [
        "stored_spans",
        () =>
          clickhouseRead({ scope: tenantScope.single({ tenantId: "project_a" }) })
            .from(storedSpans)
            .select({ TraceId: storedSpans.TraceId })
            .latestVersion()
            .build(),
      ],
      [
        "trace_summaries",
        () =>
          clickhouseRead({ scope: tenantScope.single({ tenantId: "project_a" }) })
            .from(traceSummaries)
            .select({ TraceId: traceSummaries.TraceId })
            .latestVersion()
            .build(),
      ],
      [
        "trace_analytics",
        () =>
          clickhouseRead({ scope: tenantScope.single({ tenantId: "project_a" }) })
            .from(traceAnalytics)
            .select({ TraceId: traceAnalytics.TraceId })
            .latestVersion()
            .build(),
      ],
      [
        "span_analytics",
        () =>
          clickhouseRead({ scope: tenantScope.single({ tenantId: "project_a" }) })
            .from(spanAnalytics)
            .select({ SpanId: spanAnalytics.SpanId })
            .latestVersion()
            .build(),
      ],
    ])("elects %s's latest version under the tenant's predicate and setting", (table, build) => {
      const statement = build();

      expect(statement.kind).toBe("tenant");
      expect(statement.identity).toBe("reader");
      expect(statement.settings[TENANT_SETTING]).toBe("project_a");
      expect(statement.sql).toContain(`FROM ${table}`);
      expect(statement.sql).toContain("max(");
    });
  });

  describe("when a table without a version column is read for a tenant set", () => {
    it.each([
      [
        "trace_evaluation_analytics",
        () =>
          clickhouseRead({ scope: tenantScope.set({ tenantIds: ["project_a", "project_b"] }) })
            .from(traceEvaluationAnalytics)
            .select({ EvaluationId: traceEvaluationAnalytics.EvaluationId })
            .build(),
      ],
      [
        "trace_analytics_rollup",
        () =>
          clickhouseRead({ scope: tenantScope.set({ tenantIds: ["project_a", "project_b"] }) })
            .from(traceAnalyticsRollup)
            .select({ Model: traceAnalyticsRollup.Model })
            .build(),
      ],
    ])("names every tenant of the set in %s's tenant setting", (table, build) => {
      const statement = build();

      expect(statement.kind).toBe("tenant");
      expect(statement.settings[TENANT_SETTING]).toBe("project_a,project_b");
      expect(statement.sql).toContain(`FROM ${table}`);
    });
  });
});
