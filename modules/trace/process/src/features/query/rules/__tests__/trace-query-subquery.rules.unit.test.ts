/**
 * @vitest-environment node
 * A fence can span several tenants that share a trace id, so each filter subquery matches the
 * outer row on its (tenant, key) pair, never another tenant's row with the same id (ADR-175).
 */
import { tenantScope, tenantSet } from "@langwatch/authorization/tenant-fence";
import { describe, expect, it } from "vitest";

import {
  boundedSubquery,
  instantEvalJudgmentsSubquery,
  latestEvaluationRunsSubquery,
  scenarioRunSubquery,
} from "../trace-query-subquery.rules.ts";

describe("filter subqueries", () => {
  describe("when a subquery on a trace-keyed table is built", () => {
    it("matches the outer row on its tenant and trace id together", () => {
      const subqueries = [
        boundedSubquery("stored_spans", "StartTime", "1 = 1"),
        latestEvaluationRunsSubquery({
          timeCol: "ScheduledAt",
          scopeWhere: "1 = 1",
          innerWhere: "1 = 1",
        }),
        instantEvalJudgmentsSubquery({
          by: "trace",
          runParam: "run",
          fromParam: "from",
          untilParam: "until",
        }),
      ];
      for (const sql of subqueries) {
        expect(sql).toMatch(/^\(\(TenantId, TraceId\) IN \(SELECT (DISTINCT )?TenantId, TraceId /);
      }
    });

    it("names no tenant: the span table carries its windowed marker, side tables the set", () => {
      expect(boundedSubquery("stored_spans", "StartTime", "1 = 1")).toContain(
        tenantScope("StartTime"),
      );
      expect(boundedSubquery("trace_summaries", "OccurredAt", "1 = 1")).toContain(
        tenantScope("OccurredAt"),
      );
      expect(
        latestEvaluationRunsSubquery({
          timeCol: "ScheduledAt",
          scopeWhere: "1 = 1",
          innerWhere: "1 = 1",
        }),
      ).toContain(tenantSet());
      for (const sql of [
        boundedSubquery("stored_spans", "StartTime", "1 = 1"),
        scenarioRunSubquery("1 = 1"),
      ]) {
        expect(sql).not.toContain("{tenantId:String}");
      }
    });
  });

  describe("when a subquery keyed by a hoisted attribute is built", () => {
    it("matches a conversation on its tenant and conversation id together", () => {
      expect(
        instantEvalJudgmentsSubquery({
          by: "conversation",
          runParam: "run",
          fromParam: "from",
          untilParam: "until",
        }),
      ).toMatch(/^\(\(TenantId, Attributes\['gen_ai\.conversation\.id'\]\) IN \(SELECT TenantId, /);
    });

    it("matches a scenario run on its tenant and run id together", () => {
      expect(scenarioRunSubquery("1 = 1")).toMatch(
        /^\(\(TenantId, Attributes\['scenario\.run_id'\]\) IN \(\s*SELECT TenantId, ScenarioRunId/,
      );
    });
  });
});
