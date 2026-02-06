import { describe, it, expect } from "vitest";
import { formatSchema } from "../tools/discover-schema.js";

describe("formatSchema()", () => {
  describe("when category is 'filters'", () => {
    it("includes metadata.user_id", () => {
      const result = formatSchema("filters");
      expect(result).toContain("metadata.user_id");
    });

    it("includes spans.model", () => {
      const result = formatSchema("filters");
      expect(result).toContain("spans.model");
    });

    it("includes the section header", () => {
      const result = formatSchema("filters");
      expect(result).toContain("## Available Filter Fields");
    });

    it("includes usage instructions", () => {
      const result = formatSchema("filters");
      expect(result).toContain("filters");
      expect(result).toContain("search_traces");
    });
  });

  describe("when category is 'metrics'", () => {
    it("includes performance.completion_time", () => {
      const result = formatSchema("metrics");
      expect(result).toContain("performance.completion_time");
    });

    it("includes allowed aggregations for metrics", () => {
      const result = formatSchema("metrics");
      expect(result).toContain("Aggregations:");
      expect(result).toContain("avg");
    });

    it("includes the section header", () => {
      const result = formatSchema("metrics");
      expect(result).toContain("## Available Metrics");
    });

    it("groups metrics by category", () => {
      const result = formatSchema("metrics");
      expect(result).toContain("### metadata");
      expect(result).toContain("### performance");
      expect(result).toContain("### evaluations");
    });
  });

  describe("when category is 'groups'", () => {
    it("includes model group", () => {
      const result = formatSchema("groups");
      expect(result).toContain("metadata.model");
    });

    it("includes topics group", () => {
      const result = formatSchema("groups");
      expect(result).toContain("topics.topics");
    });

    it("includes the section header", () => {
      const result = formatSchema("groups");
      expect(result).toContain("## Available Group-By Options");
    });
  });

  describe("when category is 'aggregations'", () => {
    const allAggregations = [
      "cardinality",
      "terms",
      "avg",
      "sum",
      "min",
      "max",
      "median",
      "p90",
      "p95",
      "p99",
    ];

    it("includes all 10 aggregation types", () => {
      const result = formatSchema("aggregations");
      for (const agg of allAggregations) {
        expect(result).toContain(`**${agg}**`);
      }
    });

    it("includes the section header", () => {
      const result = formatSchema("aggregations");
      expect(result).toContain("## Available Aggregation Types");
    });
  });

  describe("when category is 'all'", () => {
    it("includes the filters section", () => {
      const result = formatSchema("all");
      expect(result).toContain("## Available Filter Fields");
    });

    it("includes the metrics section", () => {
      const result = formatSchema("all");
      expect(result).toContain("## Available Metrics");
    });

    it("includes the aggregations section", () => {
      const result = formatSchema("all");
      expect(result).toContain("## Available Aggregation Types");
    });

    it("includes the groups section", () => {
      const result = formatSchema("all");
      expect(result).toContain("## Available Group-By Options");
    });
  });
});
