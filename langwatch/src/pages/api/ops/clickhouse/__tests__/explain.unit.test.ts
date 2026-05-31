import { describe, expect, it } from "vitest";
import { buildExplainQuery } from "../explain";

describe("buildExplainQuery", () => {
  it("wraps a plain SELECT with EXPLAIN PLAN by default", () => {
    const r = buildExplainQuery("SELECT count() FROM stored_spans");
    expect(r.ok).toBe(true);
    expect(r.type).toBe("PLAN");
    expect(r.wrapped).toBe("EXPLAIN PLAN SELECT count() FROM stored_spans");
  });

  it("respects an explicit type", () => {
    const r = buildExplainQuery("SELECT 1", "PIPELINE");
    expect(r.wrapped).toBe("EXPLAIN PIPELINE SELECT 1");
  });

  it("accepts every allowed type", () => {
    for (const t of ["PLAN", "SYNTAX", "PIPELINE", "AST", "INDEXES"] as const) {
      const r = buildExplainQuery("SELECT 1", t);
      expect(r.ok, `type ${t} should be allowed`).toBe(true);
    }
  });

  it("rejects an empty / whitespace-only query", () => {
    expect(buildExplainQuery("").ok).toBe(false);
    expect(buildExplainQuery("   ").ok).toBe(false);
  });

  it("rejects a query that already starts with EXPLAIN — pick `type` instead", () => {
    const r = buildExplainQuery("EXPLAIN PLAN SELECT 1");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/already starts with EXPLAIN/i);
  });

  it("rejects multi-statement queries (semicolon)", () => {
    const r = buildExplainQuery("SELECT 1; DROP TABLE stored_spans");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/single statement/i);
  });

  it("rejects forbidden mutation keywords even when inside the body", () => {
    const cases = [
      "INSERT INTO foo VALUES (1)",
      "SELECT * FROM foo WHERE bar = 'DELETE'", // string-literal — false positive, but we err on the side of safety
      "ALTER TABLE foo ADD COLUMN x Int",
      "SYSTEM RELOAD CONFIG",
      "OPTIMIZE TABLE foo FINAL",
      "ANALYZE SELECT 1", // ANALYZE specifically blocked — would execute
    ];
    for (const q of cases) {
      const r = buildExplainQuery(q);
      expect(r.ok, `should reject: ${q}`).toBe(false);
      expect(r.reason).toMatch(/forbidden keyword/i);
    }
  });

  it("word-boundary aware — does not false-reject identifiers that merely contain a keyword", () => {
    // DROP_table has no \b between DROP and _; CREATED_AT has no \b before ED.
    const benign = [
      "SELECT count() FROM foo WHERE DROP_table_count > 0",
      "SELECT created_at FROM events WHERE TenantId = 'p_x'",
    ];
    for (const q of benign) {
      const r = buildExplainQuery(q);
      expect(r.ok, `should accept: ${q}`).toBe(true);
    }
  });

  it("accepts SELECT with arrayJoin, WHERE, GROUP BY, JOIN — the realistic agent shapes", () => {
    const realistic = `
      SELECT arrayJoin(SpanAttributes.keys) AS key, count() AS n
      FROM stored_spans
      WHERE TenantId = 'p_x' AND OccurredAt > now() - INTERVAL 1 DAY
      GROUP BY key ORDER BY n DESC LIMIT 50
    `.trim();
    const r = buildExplainQuery(realistic);
    expect(r.ok).toBe(true);
    expect(r.wrapped).toContain("EXPLAIN PLAN");
    expect(r.wrapped).toContain("arrayJoin(SpanAttributes.keys)");
  });
});
