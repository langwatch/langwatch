/**
 * The 39 stock queries that ran out of memory read typed columns, never a map (analytics ADR-004).
 * @see specs/lwql/stock-widgets-read-no-map.feature
 * @vitest-environment node
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { exposedCatalogueColumns } from "../../rules/lwql-catalogue.rules.ts";
import { LWQL_CLICKHOUSE_CATALOGUE } from "../../rules/lwql-view-catalog.rules.ts";

function fixture(name: string): readonly { label: string; sql: string }[] {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8"),
  );
}

const LABELS = fixture("stock-widget-queries.light-baseline.json").map(({ label }) => label);
const STOCK = new Map(fixture("stock-widget-queries.json").map((q) => [q.label, q.sql]));

describe("given the 39 stock queries that ran out of memory on a large project", () => {
  /** @scenario "No rewritten stock query reads a map" */
  it("reads no key of Attributes, SpanAttributes or ResourceAttributes", () => {
    expect(LABELS).toHaveLength(39);
    for (const label of LABELS) {
      const sql = STOCK.get(label) ?? "";
      expect(sql, label).not.toBe("");
      expect(sql, label).not.toMatch(/\b(?:Span|Resource)?Attributes\[/);
    }
  });

  /** @scenario "No rewritten stock query reads a map" */
  it("reads captured input only for the examples ck-top-ask shows", () => {
    const reading = LABELS.filter((label) => STOCK.get(label)?.includes("CapturedInput"));
    expect(reading).toEqual(["ck-top-ask/gap"]);
    expect(STOCK.get("ck-top-ask/gap")).toContain("AND TraceId IN (SELECT trace_id FROM (");
  });
});

describe("given the columns goose 00128 adds", () => {
  /** @scenario "The new columns are exposed under their tables' access rules" */
  it("exposes each on its view from its own source column, InputHash gated like the input", () => {
    const spans = exposedCatalogueColumns({ table: LWQL_CLICKHOUSE_CATALOGUE.span_metrics });
    const traces = exposedCatalogueColumns({ table: LWQL_CLICKHOUSE_CATALOGUE.trace_metrics });
    for (const name of ["SpanType", "ErrorType", "RagContextCount", "DeploymentEnvironment"]) {
      expect(
        spans.find((column) => column.name === name),
        name,
      ).toEqual({ name, source: name });
    }
    expect(spans.find((column) => column.name === "InputHash")).toEqual({
      name: "InputHash",
      source: "InputHash",
      content: "input",
    });
    for (const name of ["MetadataOutcomeReason", "MetadataPromptVersion", "MetadataEnvironment"]) {
      expect(
        traces.find((column) => column.name === name),
        name,
      ).toEqual({ name, source: name });
    }
  });
});

describe("given the stock span widgets", () => {
  /** @scenario "The span widgets read span_metrics, not spans" */
  it("read span_metrics; only a widget's 90-day presence check still reads spans", () => {
    const readingSpans = [...STOCK].filter(([, sql]) => /\b(?:FROM|JOIN)\s+spans\b/.test(sql));
    expect(readingSpans.map(([label]) => label).every((label) => label.endsWith("/present"))).toBe(
      true,
    );
    expect([...STOCK.values()].some((sql) => sql.includes("FROM span_metrics"))).toBe(true);
  });
});
