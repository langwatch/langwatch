/**
 * The twenty-one stock queries that joined evaluation_metrics to trace_metrics read the evaluations
 * the trace fold writes, each in one read with the trace's columns on the row (analytics ADR-007).
 * @see specs/lwql/stock-widgets-read-trace-evaluations.feature
 * @vitest-environment node
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

function fixture(name: string): readonly { label: string; sql: string }[] {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8"),
  );
}

const STOCK = new Map(fixture("stock-widget-queries.json").map((q) => [q.label, q.sql]));
/** The moved queries as they read before the move. */
const BEFORE = new Map(
  fixture("stock-widget-queries.trace-evaluations-baseline.json").map((q) => [q.label, q.sql]),
);
const SOURCES = "{dashboard_context_sources:Array(String)}";

const MOVED = [
  "ans-idk/trend",
  "ans-outcomes/totals",
  "ans-outcomes/trend",
  "ans-topics/topics",
  "ask-again/trend",
  "ask-cannot/totals",
  "att-change/units",
  "att-table/passRates",
  "ck-attention/agreement",
  "ck-attention/reasons",
  "ck-attention/segments",
  "ck-kpis/checks",
  "ck-kpis/outcomes",
  "ck-top-ask/gap",
  "ck-top-ask/seen",
  "ck-trend/seen",
  "ck-trend/trend",
  "cost-verdict/outcomes",
  "rag-failure-source/trend",
  "voice-task-success/seen",
  "voice-task-success/trend",
];

/** Its traces are dated by their spans' StartTime, so its evaluation read has no trace bound. */
const DATED_BY_SPANS = ["rag-failure-source/trend"];

const sqlOf = (label: string) => STOCK.get(label) ?? "";

describe("given the stock queries that read evaluations by their trace", () => {
  /** @scenario "The moved stock queries read the trace evaluations, never evaluation_metrics" */
  it("reads trace_evaluation_metrics or trace_evaluation_checks and never evaluation_metrics", () => {
    expect([...BEFORE.keys()].toSorted()).toEqual(MOVED);
    for (const label of MOVED) {
      const sql = sqlOf(label);
      expect(BEFORE.get(label), label).toMatch(/\bFROM evaluation_metrics\b/);
      expect(sql, label).toMatch(/\bFROM trace_evaluation_(metrics|checks)\b/);
      expect(sql, label).not.toMatch(/\b(FROM|JOIN) evaluation_metrics\b/);
    }
  });

  /** @scenario "The moved stock queries read the trace evaluations, never evaluation_metrics" */
  it("bounds every read below on OccurredAt and TraceOccurredAt and keeps both sources to the list", () => {
    for (const label of MOVED) {
      const sql = sqlOf(label);
      const reads = sql.split(/\bFROM trace_evaluation_/).slice(1);
      expect(reads.length, label).toBeGreaterThan(0);
      const kept = sql.match(new RegExp(`\\w+\\.TraceSource IN ${escaped(SOURCES)}`, "g")) ?? [];
      expect(kept, label).toHaveLength(reads.length);
      for (const read of reads) {
        expect(read, label).toMatch(/\bOccurredAt >= /);
        const bounds = DATED_BY_SPANS.includes(label) ? [] : [/\bTraceOccurredAt >= /];
        for (const bound of bounds) expect(read, label).toMatch(bound);
      }
    }
  });

  /** @scenario "Judge agreement counts the narrow view's evaluations for thumbed traces only" */
  it("sums Evaluations over trace_evaluation_checks for the traces a reviewer thumbed", () => {
    const sql = sqlOf("ck-attention/agreement");
    expect(sql).toContain("FROM trace_evaluation_checks");
    expect(sql).toContain("sum(e.n) AS audited");
    expect(sql).toContain("Evaluations AS n");
    expect(sql).toMatch(/AND TraceId IN \(SELECT TraceId FROM annotations WHERE /);
    expect(sql).not.toMatch(/\bSign\b/);
    expect(sql).not.toContain("trace_evaluation_metrics");
  });

  /** @scenario "Only the evaluation side of a mixed stock query moves" */
  it("keeps ck-top-ask's example lookup on traces and rag-failure-source's spans on span_metrics", () => {
    expect(sqlOf("ck-top-ask/gap")).toContain("CapturedInput AS input\n  FROM traces");
    expect(sqlOf("ck-top-ask/gap")).toContain("MetadataOutcome AS outcome");
    expect(sqlOf("rag-failure-source/trend")).toMatch(/\bFROM span_metrics\b/);
  });

  /** @scenario "The moved stock queries read the trace evaluations, never evaluation_metrics" */
  it("names Sign in no stock query", () => {
    for (const [label, sql] of STOCK) expect(sql, label).not.toMatch(/\bSign\b/);
  });
});

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
