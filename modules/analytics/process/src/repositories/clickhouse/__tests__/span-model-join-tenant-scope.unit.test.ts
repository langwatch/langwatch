/**
 * The span-model join's own WHERE is one disjunction. Left unbracketed it sat
 * at the same bracket depth as the tenant predicate, so the ClickHouse tenant
 * guard refused the whole statement and every analytics graph 500'd.
 * @see dev/docs/best_practices/clickhouse-queries.md
 */
import { checkTenantScope, expandStatement, fenceFor } from "@langwatch/clickhouse-client";
import { describe, expect, it } from "vitest";

import { analyticsProof } from "../../__tests__/analytics-proof.fixture.ts";
import { buildTimeseriesQuery } from "../clickhouse.aggregation-builder.mapper.ts";

const TENANT = "local-dev-project";
const MEMBER = "local-dev-member";

/** An aggregate's fence: the project outright, one member inside its grant's window. */
const AGGREGATE_FENCE = fenceFor({
  authorization: analyticsProof({
    projectId: TENANT,
    shared: [{ projectId: MEMBER, from: 1786000000000 }],
  }),
  reads: "analytics",
});

/** What the analytics home asks for when it breaks a metric down by model. */
function modelBreakdownQuery() {
  return buildTimeseriesQuery({
    projectId: TENANT,
    startDate: 1787176800000,
    endDate: 1789766707887,
    previousPeriodStartDate: 1784587000000,
    filters: {},
    timeZone: "Europe/Amsterdam",
    timeScale: 1440,
    groupBy: "metadata.model",
    series: [{ name: "Traces", metric: "metadata.trace_id", aggregation: "cardinality" }],
  } as never);
}

describe("given a timeseries grouped by model, which joins the span-model rollup", () => {
  describe("when the tenant guard reads the statement it built", () => {
    it("accepts it, because no disjunction sits at the tenant predicate's depth", () => {
      const built = modelBreakdownQuery();
      const expanded = expandStatement({
        query: built.sql,
        queryParams: built.params,
        fence: AGGREGATE_FENCE,
      });

      const verdict = checkTenantScope({
        sql: expanded.query,
        params: expanded.queryParams,
        tenantId: TENANT,
        tenantIds: [TENANT, MEMBER],
      });

      expect(verdict).toBeNull();
    });

    it("still filters the join to rows that carry a model or a cost", () => {
      // The bracket must not change what the disjunction selects.
      const { sql } = modelBreakdownQuery();

      expect(sql).toContain("SpanModelKey != 'unknown'");
      expect(sql).toContain("OR SpanModelReasoningTokens > 0");
    });
  });
});
