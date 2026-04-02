import { describe, expect, it } from "vitest";
import {
  metricColumnMap,
  groupByColumnMap,
  filterColumnMap,
  factTableNames,
} from "../metric-column-map";

describe("metricColumnMap", () => {
  describe("when looking up trace metrics", () => {
    it("maps metadata.trace_id to TraceId with identity flag", () => {
      const mapping = metricColumnMap["metadata.trace_id"];
      expect(mapping).toEqual({
        table: "trace",
        column: "TraceId",
        isIdentity: true,
      });
    });

    it("maps performance.total_cost to TotalCost", () => {
      const mapping = metricColumnMap["performance.total_cost"];
      expect(mapping).toEqual({
        table: "trace",
        column: "TotalCost",
      });
    });

    it("maps performance.total_tokens to a coalesce expression", () => {
      const mapping = metricColumnMap["performance.total_tokens"];
      expect(mapping?.column).toContain("coalesce");
      expect(mapping?.table).toBe("trace");
    });

    it("maps sentiment.thumbs_up_down to ThumbsUpDownVote", () => {
      const mapping = metricColumnMap["sentiment.thumbs_up_down"];
      expect(mapping).toEqual({
        table: "trace",
        column: "ThumbsUpDownVote",
      });
    });
  });

  describe("when looking up evaluation metrics", () => {
    it("maps evaluations.evaluation_score to Score", () => {
      const mapping = metricColumnMap["evaluations.evaluation_score"];
      expect(mapping).toEqual({
        table: "evaluation",
        column: "Score",
      });
    });

    it("maps evaluations.evaluation_runs to EvaluationId with identity flag", () => {
      const mapping = metricColumnMap["evaluations.evaluation_runs"];
      expect(mapping).toEqual({
        table: "evaluation",
        column: "EvaluationId",
        isIdentity: true,
      });
    });
  });

  describe("when looking up a nonexistent metric", () => {
    it("returns undefined", () => {
      const mapping = metricColumnMap["nonexistent.metric"];
      expect(mapping).toBeUndefined();
    });
  });
});

describe("groupByColumnMap", () => {
  it("maps topics.topics to TopicId on trace table", () => {
    expect(groupByColumnMap["topics.topics"]).toEqual({
      table: "trace",
      column: "TopicId",
    });
  });

  it("marks array columns with isArray flag", () => {
    expect(groupByColumnMap["metadata.labels"]?.isArray).toBe(true);
    expect(groupByColumnMap["metadata.model"]?.isArray).toBe(true);
  });

  it("maps evaluation group columns to evaluation table", () => {
    expect(groupByColumnMap["evaluations.evaluation_passed"]?.table).toBe(
      "evaluation",
    );
    expect(groupByColumnMap["evaluations.evaluation_label"]?.table).toBe(
      "evaluation",
    );
  });
});

describe("filterColumnMap", () => {
  it("maps metadata filters to trace table columns", () => {
    expect(filterColumnMap["metadata.user_id"]).toEqual({
      table: "trace",
      column: "UserId",
    });
  });

  it("maps evaluation filters to evaluation table columns", () => {
    expect(filterColumnMap["evaluations.evaluator_id"]).toEqual({
      table: "evaluation",
      column: "EvaluatorId",
    });
  });

  it("marks array filter columns with isArray flag", () => {
    expect(filterColumnMap["metadata.labels"]?.isArray).toBe(true);
    expect(filterColumnMap["spans.model"]?.isArray).toBe(true);
  });
});

describe("factTableNames", () => {
  it("maps trace to analytics_trace_facts", () => {
    expect(factTableNames.trace).toBe("analytics_trace_facts");
  });

  it("maps evaluation to analytics_evaluation_facts", () => {
    expect(factTableNames.evaluation).toBe("analytics_evaluation_facts");
  });
});
