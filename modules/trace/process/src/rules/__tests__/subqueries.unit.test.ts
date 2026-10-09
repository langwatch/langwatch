/**
 * @vitest-environment node
 * A fence may span tenants sharing a trace id, so each filter subquery matches
 * the outer row on its (tenant, key) pair. Live proof: `trace-list.proof.integration.test.ts`.
 */
import { describe, expect, it } from "vitest";

import {
  boundedSubquery,
  instantEvalJudgmentsSubquery,
  latestEvaluationRunsSubquery,
  scenarioRunSubquery,
} from "../../features/query/repositories/clickhouse/clickhouse.trace-query-subquery.mapper.ts";

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
