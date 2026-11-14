/**
 * The metadata keys the stock widgets read are typed columns of `trace_metrics`, and the widget
 * queries that need nothing else read them there rather than from `traces` (tasks#1117).
 * @see specs/lwql/stock-widgets-on-trace-metrics.feature
 * @vitest-environment node
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { exposedCatalogueColumns } from "../../rules/lwql-catalogue.rules.ts";
import {
  LWQL_CLICKHOUSE_CATALOGUE,
  LWQL_VIEW_CATALOG,
} from "../../rules/lwql-view-catalog.rules.ts";

const METADATA_COLUMNS = [
  "MetadataOutputAction",
  "MetadataOutcome",
  "MetadataSentToReview",
  "MetadataDocumentType",
  "MetadataFlow",
  "MetadataLanguage",
  "MetadataSegment",
  "MetadataTeam",
  "MetadataTopic",
];

const MOVED = [
  "gen-acceptance/actions",
  "gen-acceptance/seen",
  "gen-dropoff/main",
  "data-health/fields",
  "ext-human-review/trend",
  "ext-human-review/summary",
  "ext-human-review/byUnit",
  "cost-by-segment/units",
  "cost-by-segment/totals",
  "att-share/units",
  "att-share/totals",
  "att-table/units",
  "att-table/passRates",
  "ask-rising/shares",
  "ask-rising/daily",
];

const queries: readonly { label: string; sql: string }[] = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures/stock-widget-queries.json", import.meta.url)),
    "utf8",
  ),
);

/** The views the SQL names after FROM or JOIN. */
function namedViews(sql: string): string[] {
  return [...sql.matchAll(/\b(?:FROM|JOIN)\s+(?:analytics\.)?([a-z_]+)/gi)].map(
    (match) => match[1] ?? "",
  );
}

describe("given the trace_metrics view", () => {
  const view = LWQL_VIEW_CATALOG.find(({ name }) => name === "trace_metrics");
  const exposed = exposedCatalogueColumns({ table: LWQL_CLICKHOUSE_CATALOGUE.trace_metrics });

  /** @scenario "trace_metrics exposes the metadata columns under its own access rules" */
  it("exposes each metadata column as text read from its own source column", () => {
    const traceName = view?.columns.find((candidate) => candidate.name === "TraceName");
    for (const name of METADATA_COLUMNS) {
      const column = view?.columns.find((candidate) => candidate.name === name);
      expect(column, name).toMatchObject({ type: "String", sourceColumns: [name] });
      expect(column?.gates, name).toEqual(traceName?.gates);
      expect(
        exposed.find((candidate) => candidate.name === name),
        name,
      ).toEqual({
        name,
        source: name,
      });
    }
  });

  /** @scenario "trace_metrics keeps its latest-version dedup without FINAL" */
  it("keeps deduplicating on its sort key by the latest UpdatedAt, ties broken by Version", () => {
    expect(view?.dedup).toEqual({
      keyColumns: ["TenantId", "OccurredAt", "TraceId"],
      versionColumn: "UpdatedAt",
      strategy: "latest-in-order",
      tieBreakColumns: ["Version"],
    });
  });

  /** @scenario "trace_metrics keeps the Attributes map withheld" */
  it("still withholds the Attributes map", () => {
    expect(view?.columns.map(({ name }) => name)).not.toContain("Attributes");
    expect(LWQL_CLICKHOUSE_CATALOGUE.trace_metrics.columns.Attributes).toBe("omit");
  });
});

describe("given the moved stock widget queries", () => {
  /** @scenario "The moved widget queries read trace_metrics, not traces" */
  it("reads trace_metrics and never traces", () => {
    const moved = queries.filter(({ label }) => MOVED.includes(label));
    expect(moved.map(({ label }) => label).toSorted()).toEqual(MOVED.toSorted());

    for (const { label, sql } of moved) {
      const views = namedViews(sql);
      expect(views, label).toContain("trace_metrics");
      expect(views, label).not.toContain("traces");
      expect(sql, label).not.toContain("Attributes[");
      expect(sql, label).toContain("Source IN {dashboard_context_sources:Array(String)}");
    }
  });
});
