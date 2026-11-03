import type { AnalyticsSeries } from "@langwatch/analytics-contract";
/**
 * Two members of an aggregate can hold the same thread, user or customer id (ADR-177). Every
 * per-entity count and pipeline keys the id by its member; the bare id merged them.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { buildTimeseriesQuery } from "../clickhouse.aggregation-builder.mapper.ts";
import { resetParamCounter } from "../clickhouse.filter-translator.mapper.ts";
import {
  memberScopedTraceAttribute,
  translateMetric,
  translatePipelineAggregation,
} from "../clickhouse.metric-translator.mapper.ts";
import { buildSlimTimeseriesQuery } from "../clickhouse.slim-timeseries-query.mapper.ts";

const THREAD_KEY = memberScopedTraceAttribute("gen_ai.conversation.id");
const USER_KEY = memberScopedTraceAttribute("langwatch.user_id");

const baseInput = {
  projectId: "test-project",
  startDate: new Date("2024-01-01T00:00:00Z"),
  endDate: new Date("2024-01-02T00:00:00Z"),
  previousPeriodStartDate: new Date("2023-12-31T00:00:00Z"),
  timeScale: "full",
};

function build(series: AnalyticsSeries[], groupBy?: string) {
  return buildTimeseriesQuery({ ...baseInput, series, groupBy } as never);
}

describe("memberScopedTraceAttribute()", () => {
  it("keys the id by the member and stays empty when the id is", () => {
    expect(THREAD_KEY).toBe(
      "if(ts.Attributes['gen_ai.conversation.id'] = '', '', concat(ts.TenantId, '/', ts.Attributes['gen_ai.conversation.id']))",
    );
  });
});

describe("translateMetric()", () => {
  describe.each([
    ["metadata.thread_id", THREAD_KEY],
    ["metadata.user_id", USER_KEY],
  ])("given a %s cardinality", (metric, key) => {
    it("counts the member-scoped key, never the bare id", () => {
      const { selectExpression } = translateMetric({
        metric,
        aggregation: "cardinality",
        index: 0,
      });

      expect(selectExpression).toBe(
        `uniqIf(${key}, ${key} != '') AS 0__${metric.replace(".", "_")}__cardinality`,
      );
    });
  });

  describe("given the average thread duration", () => {
    it("groups the per-thread duration by the member-scoped thread", () => {
      const { subquery } = translateMetric({
        metric: "threads.average_duration_per_thread",
        aggregation: "avg",
        index: 0,
      });

      expect(subquery?.innerSelect).toContain(`${THREAD_KEY} AS thread_id`);
    });
  });
});

describe("translatePipelineAggregation()", () => {
  describe.each([
    ["user_id", USER_KEY],
    ["thread_id", THREAD_KEY],
    ["customer_id", memberScopedTraceAttribute("langwatch.customer_id")],
  ])("given a %s pipeline", (pipelineField, key) => {
    it("groups each entity by its member-scoped key", () => {
      const { subquery } = translatePipelineAggregation({
        metric: "metadata.trace_id",
        aggregation: "cardinality",
        pipelineField,
        pipelineAggregation: "avg",
        index: 0,
      });

      expect(subquery?.innerSelect).toContain(`${key} AS pipeline_key`);
    });
  });

  describe("given a per-user thread duration", () => {
    it("keys both the user and the thread by the member", () => {
      const { subquery } = translatePipelineAggregation({
        metric: "threads.average_duration_per_thread",
        aggregation: "avg",
        pipelineField: "user_id",
        pipelineAggregation: "avg",
        index: 0,
      });

      expect(subquery?.nestedSubquery?.select).toContain(`${USER_KEY} AS pipeline_key`);
      expect(subquery?.nestedSubquery?.select).toContain(`${THREAD_KEY} AS thread_id`);
    });
  });
});

describe("buildTimeseriesQuery()", () => {
  beforeEach(() => {
    resetParamCounter();
  });

  describe("given a thread count beside an evaluation metric", () => {
    it("carries the member-scoped key whole into the per-trace CTE", () => {
      const { sql } = build([
        { metric: "metadata.thread_id", aggregation: "cardinality" },
        { metric: "evaluations.evaluation_score", aggregation: "avg", key: "check" },
      ]);

      expect(sql).toContain(`any(${THREAD_KEY})`);
      expect(sql).not.toContain(`uniqIf(${THREAD_KEY}`);
    });
  });
});

describe("buildSlimTimeseriesQuery()", () => {
  it("counts each slim thread and user by its member", () => {
    const { sql } = buildSlimTimeseriesQuery({
      ...baseInput,
      series: [
        { metric: "metadata.thread_id", aggregation: "cardinality" },
        { metric: "metadata.user_id", aggregation: "cardinality" },
      ],
    } as never);

    expect(sql).toContain(
      "uniq(if(ta.ConversationId = '', '', concat(ta.TenantId, '/', ta.ConversationId)))",
    );
    expect(sql).toContain("uniq(if(ta.UserId = '', '', concat(ta.TenantId, '/', ta.UserId)))");
  });
});
