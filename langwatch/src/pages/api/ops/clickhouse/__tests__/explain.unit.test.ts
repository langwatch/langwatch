import { describe, expect, it } from "vitest";
import { buildExplainQuery, redactQueryForAudit } from "../explain";

// A minimal SELECT that satisfies the tenant-predicate invariant. Used as
// the "valid baseline" everywhere we need an otherwise-acceptable shape so
// the test is exercising the OTHER rejection paths in isolation.
const TENANT_OK = "SELECT count() FROM stored_spans WHERE TenantId = 'p_x'";

describe("buildExplainQuery", () => {
  it("wraps a tenant-scoped SELECT with EXPLAIN PLAN by default", () => {
    const r = buildExplainQuery(TENANT_OK);
    expect(r.ok).toBe(true);
    expect(r.type).toBe("PLAN");
    expect(r.wrapped).toBe(`EXPLAIN PLAN ${TENANT_OK}`);
  });

  it("respects an explicit type", () => {
    const r = buildExplainQuery(TENANT_OK, "PIPELINE");
    expect(r.wrapped).toBe(`EXPLAIN PIPELINE ${TENANT_OK}`);
  });

  it("accepts every allowed type", () => {
    for (const t of ["PLAN", "SYNTAX", "PIPELINE", "AST", "INDEXES"] as const) {
      const r = buildExplainQuery(TENANT_OK, t);
      expect(r.ok, `type ${t} should be allowed`).toBe(true);
    }
  });

  it("rejects an empty / whitespace-only query", () => {
    expect(buildExplainQuery("").ok).toBe(false);
    expect(buildExplainQuery("   ").ok).toBe(false);
  });

  it("rejects a query that already starts with EXPLAIN — pick `type` instead", () => {
    const r = buildExplainQuery(`EXPLAIN PLAN ${TENANT_OK}`);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/already starts with EXPLAIN/i);
  });

  it("rejects multi-statement queries (semicolon)", () => {
    const r = buildExplainQuery(`${TENANT_OK}; DROP TABLE stored_spans`);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/single statement/i);
  });

  it("rejects forbidden mutation keywords even when inside the body", () => {
    const cases = [
      "INSERT INTO foo VALUES (1)",
      "SELECT * FROM foo WHERE bar = 'DELETE' AND TenantId = 'p_x'", // string-literal still rejected (acceptable false positive)
      "ALTER TABLE foo ADD COLUMN x Int",
      "SYSTEM RELOAD CONFIG",
      "OPTIMIZE TABLE foo FINAL",
      `ANALYZE ${TENANT_OK}`, // ANALYZE specifically blocked — would execute
    ];
    for (const q of cases) {
      const r = buildExplainQuery(q);
      expect(r.ok, `should reject: ${q}`).toBe(false);
      expect(r.reason).toMatch(/forbidden keyword/i);
    }
  });

  it("word-boundary aware — does not false-reject identifiers that merely contain a keyword", () => {
    const benign = [
      "SELECT count() FROM foo WHERE TenantId = 'p_x' AND DROP_table_count > 0",
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

  it("rejects ClickHouse table functions that could exfiltrate (SSRF surface)", () => {
    const cases = [
      `SELECT * FROM url('http://evil.example/x', CSV, 'a String') WHERE TenantId = 'p_x'`,
      `SELECT * FROM s3('s3://bucket/x', 'k', 's', 'CSV') WHERE TenantId = 'p_x'`,
      `SELECT * FROM remote('other-host:9000', default.stored_spans) WHERE TenantId = 'p_x'`,
      `SELECT * FROM postgresql('host:5432', 'db', 'tab', 'u', 'p') WHERE TenantId = 'p_x'`,
      `SELECT * FROM file('/etc/passwd', CSV, 'l String') WHERE TenantId = 'p_x'`,
      `SELECT * FROM mysql('host:3306', 'db', 'tab', 'u', 'p') WHERE TenantId = 'p_x'`,
      `SELECT * FROM cluster('ch', default.stored_spans) WHERE TenantId = 'p_x'`,
      `SELECT * FROM redis('host:6379', 0, 'key UInt64, val String') WHERE TenantId = 'p_x'`,
    ];
    for (const q of cases) {
      const r = buildExplainQuery(q);
      expect(r.ok, `should reject: ${q}`).toBe(false);
      expect(r.reason).toMatch(/table function/i);
    }
  });

  it("does NOT false-reject scalar / aggregate functions that share names with table functions in name only", () => {
    // 'file' the table function is `file(...)`; if a user happened to define
    // a column named `file` we accept references like `WHERE file = 'x'`.
    const benign = `SELECT file FROM stored_spans WHERE TenantId = 'p_x' AND file = 'x.png'`;
    const r = buildExplainQuery(benign);
    expect(r.ok, "bare identifier `file` should not trip the table-function check").toBe(true);
  });

  it("rejects references to the system.* schema (server internals)", () => {
    const r = buildExplainQuery("SELECT * FROM system.users WHERE TenantId = 'p_x'");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/system/i);
  });

  it("rejects an unscoped query — multitenancy invariant", () => {
    const r = buildExplainQuery("SELECT count() FROM stored_spans");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/TenantId/);
  });
});

describe("redactQueryForAudit", () => {
  it("replaces string literals with '?' so tenant ids and PII don't end up in logs", () => {
    const { shape } = redactQueryForAudit(
      "SELECT * FROM events WHERE TenantId = 'p_acme' AND email = 'alice@example.com'"
    );
    expect(shape).toContain("TenantId = '?'");
    expect(shape).toContain("email = '?'");
    expect(shape).not.toContain("p_acme");
    expect(shape).not.toContain("alice");
  });

  it("replaces numeric literals with ?", () => {
    const { shape } = redactQueryForAudit("SELECT * FROM x WHERE id = 12345 AND ts > 1700000000");
    expect(shape).not.toMatch(/\b12345\b/);
    expect(shape).not.toMatch(/\b1700000000\b/);
    expect(shape).toContain("id = ? AND ts > ?");
  });

  it("returns a stable 16-char sha256 prefix to correlate identical queries", () => {
    const a = redactQueryForAudit("SELECT 1 FROM x WHERE TenantId = 'p_x'");
    const b = redactQueryForAudit("SELECT 1 FROM x WHERE TenantId = 'p_x'");
    expect(a.sha256).toBe(b.sha256);
    expect(a.sha256).toMatch(/^[0-9a-f]{16}$/);
  });

  it("caps the shape at 300 chars even for huge queries", () => {
    const big = "SELECT " + "x, ".repeat(500) + " FROM y WHERE TenantId = 'p_x'";
    const { shape } = redactQueryForAudit(big);
    expect(shape.length).toBeLessThanOrEqual(300);
  });
});
