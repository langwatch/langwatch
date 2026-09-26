/**
 * `discover_schema`'s renderer, fed the committed reference fixture (generated from
 * `describeQueryReference` and pinned platform-side), so these assert RENDERING only; the fetch is
 * integration-tested.
 * @see specs/mcp-server/schema-discovery.feature
 */
import { describe, it, expect } from "vitest";

import type { QueryReferenceResponse } from "../langwatch-api-query.js";
import { formatSchema, needsQueryReference } from "../tools/discover-schema.js";
import fixture from "./fixtures/query-reference.json" with { type: "json" };

const reference = fixture as unknown as QueryReferenceResponse;

describe("needsQueryReference()", () => {
  it("is true for the categories the platform owns", () => {
    expect(needsQueryReference("filters")).toBe(true);
    expect(needsQueryReference("lwql")).toBe(true);
    expect(needsQueryReference("all")).toBe(true);
  });

  it("is false for the categories this package still owns", () => {
    expect(needsQueryReference("metrics")).toBe(false);
    expect(needsQueryReference("aggregations")).toBe(false);
    expect(needsQueryReference("groups")).toBe(false);
  });
});

describe("formatSchema()", () => {
  describe("when category is 'filters'", () => {
    it("lists the fields the platform publishes", async () => {
      const result = await formatSchema("filters", reference);
      for (const field of reference.traceFilter.fields.slice(0, 10)) {
        expect(result).toContain(field.name);
      }
    });

    it("documents the attribute prefixes", async () => {
      const result = await formatSchema("filters", reference);
      expect(result).toContain("trace.attribute.");
      expect(result).toContain("span.attribute.");
      expect(result).toContain("event.attribute.");
    });

    it("includes the language's syntax", async () => {
      const result = await formatSchema("filters", reference);
      expect(result).toContain("Trace query syntax");
    });

    it("names the tool the filter is sent to", async () => {
      const result = await formatSchema("filters", reference);
      expect(result).toContain("search_traces");
    });

    it("says where the open value sets come from", async () => {
      const result = await formatSchema("filters", reference);
      expect(result).toContain("/api/v1/traces/facets");
    });

    it("shows worked filters", async () => {
      const result = await formatSchema("filters", reference);
      const example = reference.examples.find((candidate) => candidate.language === "trace-filter");
      // Asserted before it is used: `toContain(undefined ?? "")` passes against
      // any string at all, so a fixture that lost its filter examples would
      // read as a rendering that still shows them.
      expect(example).toBeDefined();
      expect(result).toContain(example?.text);
    });
  });

  describe("when category is 'lwql'", () => {
    it("lists every view with its time column", async () => {
      const result = await formatSchema("lwql", reference);
      for (const view of reference.lwql.schema.views) {
        expect(result).toContain(view.name);
        expect(result).toContain(view.timeColumn);
      }
    });

    it("shows runnable statements", async () => {
      const result = await formatSchema("lwql", reference);
      const example = reference.examples.find((candidate) => candidate.language === "lwql");
      expect(example).toBeDefined();
      const firstLine = example?.text.split("\n")[0];
      expect(firstLine).toBeTruthy();
      expect(result).toContain(firstLine);
    });

    it("says the statement is run as written", async () => {
      const result = await formatSchema("lwql", reference);
      expect(result).toContain("as written");
    });
  });

  describe("when the analytics SQL surface is closed to the project", () => {
    it("says so instead of listing datasets", async () => {
      const closed = {
        ...reference,
        lwql: { ...reference.lwql, enabled: false },
      };
      const result = await formatSchema("lwql", closed);
      expect(result).toContain("Not enabled for this project");
      expect(result).not.toContain("### analytics.traces");
    });
  });

  describe("when category is 'metrics'", () => {
    it("includes performance.completion_time", async () => {
      const result = await formatSchema("metrics");
      expect(result).toContain("performance.completion_time");
    });

    it("includes allowed aggregations for metrics", async () => {
      const result = await formatSchema("metrics");
      expect(result).toContain("Aggregations:");
      expect(result).toContain("avg");
    });

    it("includes the section header", async () => {
      const result = await formatSchema("metrics");
      expect(result).toContain("## Available Metrics");
    });

    it("groups metrics by category", async () => {
      const result = await formatSchema("metrics");
      expect(result).toContain("### metadata");
      expect(result).toContain("### performance");
      expect(result).toContain("### evaluations");
    });
  });

  describe("when category is 'groups'", () => {
    it("includes model group", async () => {
      const result = await formatSchema("groups");
      expect(result).toContain("metadata.model");
    });

    it("includes topics group", async () => {
      const result = await formatSchema("groups");
      expect(result).toContain("topics.topics");
    });

    it("includes the section header", async () => {
      const result = await formatSchema("groups");
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

    it("includes all 10 aggregation types", async () => {
      const result = await formatSchema("aggregations");
      for (const agg of allAggregations) {
        expect(result).toContain(`**${agg}**`);
      }
    });

    it("includes the section header", async () => {
      const result = await formatSchema("aggregations");
      expect(result).toContain("## Available Aggregation Types");
    });
  });

  describe("when category is 'all'", () => {
    it("includes every section", async () => {
      const result = await formatSchema("all", reference);
      expect(result).toContain("## Trace Filter Fields");
      expect(result).toContain("## Analytics SQL");
      expect(result).toContain("## Available Metrics");
      expect(result).toContain("## Available Aggregation Types");
      expect(result).toContain("## Available Group-By Options");
    });

    it("says which language answers which question", async () => {
      const result = await formatSchema("all", reference);
      expect(result).toContain("## Which one to reach for");
      const first = reference.decisionTable[0];
      expect(first).toBeDefined();
      expect(result).toContain(first?.when);
    });
  });
});
