/**
 * Metric specs (ADR-202 Decided 19): which tables a metric reads, which re-aggregate, and what the
 * renderer refuses. Rendered rows on trace_summaries are proven on 26.8 by the row-equality suite.
 */
import { describe, expect, it } from "vitest";

import {
  ArrayMetricConditionUnbuiltError,
  type MetricSource,
  metricSpecFor,
  pipelineMetricSpecFor,
  renderMetric,
} from "../clickhouse.metric-spec.mapper.ts";
import { traceSummaries as ts } from "../clickhouse.trace-summaries.table.ts";

const spec = (metric: string, aggregation = "avg", key?: string) =>
  metricSpecFor({ metric, aggregation: aggregation as never, index: 0, key });

const SOURCE: MetricSource<"trace_summaries"> = {
  trace: (name) => ts[name],
  attribute: () => ts.Attributes,
  span: () => ts.Models,
  evaluation: () => ts.TraceName,
};

describe("metricSpecFor", () => {
  it("reads trace metrics off the trace row alone", () => {
    for (const metric of [
      "performance.total_cost",
      "performance.cost_billed",
      "performance.total_tokens",
      "metadata.trace_id",
      "metadata.user_id",
      "metrics.total_cost",
    ]) {
      expect(spec(metric).joins, metric).toEqual([]);
    }
    expect(spec("metadata.span_type", "cardinality").joins).toEqual([]);
  });

  it("joins the spans or the evaluation runs where main joined them", () => {
    expect(spec("metadata.span_type", "terms").joins).toEqual(["stored_spans"]);
    expect(spec("spans.metrics.prompt_tokens").joins).toEqual(["stored_spans"]);
    expect(spec("events.event_score").joins).toEqual(["stored_spans"]);
    expect(spec("sentiment.thumbs_up_down").joins).toEqual(["stored_spans"]);
    expect(spec("evaluations.evaluation_score", "avg", "ev").joins).toEqual(["evaluation_runs"]);
  });

  it("aggregates event scores and votes over every element of the per-span arrays", () => {
    expect(spec("events.event_score").form).toBe("array");
    expect(spec("sentiment.thumbs_up_down", "avg").form).toBe("array");
    expect(spec("sentiment.thumbs_up_down", "cardinality").form).toBe("scalar");
  });

  it("re-aggregates threads and pipelines over an inner grouping", () => {
    expect(spec("threads.average_duration_per_thread").outer?.kind).toBe("thread-duration");
    const pipeline = pipelineMetricSpecFor({
      metric: "performance.total_cost",
      aggregation: "sum",
      pipelineField: "user_id",
      pipelineAggregation: "avg",
      index: 0,
    });
    expect(pipeline.outer).toMatchObject({ kind: "per-entity", aggregation: "avg" });
  });

  it("refuses a metric it has no spec for, naming the series", () => {
    expect(() => spec("not.a.metric")).toThrow(
      expect.objectContaining({ code: expect.any(String) }),
    );
  });
});

describe("renderMetric", () => {
  it("refuses an array metric with a condition until the builder has -ArrayIf", () => {
    expect(() =>
      renderMetric({
        spec: spec("events.event_score"),
        source: SOURCE,
        when: ts.ContainsErrorStatus,
      }),
    ).toThrow(ArrayMetricConditionUnbuiltError);
  });

  it("leaves a re-aggregated metric to its query shape", () => {
    expect(() =>
      renderMetric({ spec: spec("threads.average_duration_per_thread"), source: SOURCE }),
    ).toThrow("rendered by its query shape");
  });
});
