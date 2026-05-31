import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  _resetOpsClickHouseClientForTesting,
  buildExplainQuery,
  getOpsClickHouseClient,
  redactQueryForAudit,
  stripCommentsAndStrings,
} from "../explain-core";

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

  it("rejects forbidden mutation keywords", () => {
    const cases = [
      "INSERT INTO foo VALUES (1)",
      "ALTER TABLE foo ADD COLUMN x Int",
      "SYSTEM RELOAD CONFIG",
      "OPTIMIZE TABLE foo FINAL",
      `ANALYZE ${TENANT_OK}`,
    ];
    for (const q of cases) {
      const r = buildExplainQuery(q);
      expect(r.ok, `should reject: ${q}`).toBe(false);
      expect(r.reason).toMatch(/forbidden keyword/i);
    }
  });

  it("does not reject a forbidden keyword that only appears inside a string literal", () => {
    const q = "SELECT * FROM foo WHERE bar = 'DELETE' AND TenantId = 'p_x'";
    expect(buildExplainQuery(q).ok).toBe(true);
  });

  it("accepts realistic agent shapes (arrayJoin, WHERE, GROUP BY)", () => {
    const realistic = `
      SELECT arrayJoin(SpanAttributes.keys) AS key, count() AS n
      FROM stored_spans
      WHERE TenantId = 'p_x' AND OccurredAt > now() - INTERVAL 1 DAY
      GROUP BY key ORDER BY n DESC LIMIT 50
    `.trim();
    expect(buildExplainQuery(realistic).ok).toBe(true);
  });

  it("rejects ClickHouse table functions (SSRF surface)", () => {
    const cases = [
      `SELECT * FROM url('http://evil.example/x', CSV, 'a String')`,
      `SELECT * FROM s3('s3://bucket/x', 'k', 's', 'CSV')`,
      `SELECT * FROM remote('other-host:9000', default.stored_spans)`,
      `SELECT * FROM postgresql('host:5432', 'db', 'tab', 'u', 'p')`,
      `SELECT * FROM file('/etc/passwd', CSV, 'l String')`,
      `SELECT * FROM mysql('host:3306', 'db', 'tab', 'u', 'p')`,
      `SELECT * FROM cluster('ch', default.stored_spans)`,
      `SELECT * FROM redis('host:6379', 0, 'key UInt64, val String')`,
    ];
    for (const q of cases) {
      const r = buildExplainQuery(q);
      expect(r.ok, `should reject: ${q}`).toBe(false);
      expect(r.reason).toMatch(/table function/i);
    }
  });

  it("accepts a cross-tenant query — operator endpoint by design", () => {
    expect(buildExplainQuery("SELECT count() FROM stored_spans").ok).toBe(true);
  });

  it("rejects references to the system.* schema", () => {
    const r = buildExplainQuery("SELECT * FROM system.users");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/system/i);
  });

  describe("comment / string-literal bypasses", () => {
    it("rejects table functions hidden behind a block comment", () => {
      const r = buildExplainQuery(`SELECT * FROM url/**/('http://127.0.0.1:9/', CSV)`);
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/table function/i);
    });

    it("rejects a string-opener-inside-string bypass", () => {
      const q = `SELECT * FROM stored_spans WHERE '/*' = 'literal' OR SpanId IN (SELECT SpanId FROM url('http://127.0.0.1:9/', CSV)) /* trailing */`;
      const r = buildExplainQuery(q);
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/table function/i);
    });

    it("rejects DROP split by a block comment", () => {
      const r = buildExplainQuery(`DROP/**/TABLE stored_spans`);
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/forbidden keyword/i);
    });

    it("does not treat `;` inside a string as multi-statement", () => {
      expect(buildExplainQuery(`SELECT name FROM stored_spans WHERE name = 'a;b'`).ok).toBe(true);
    });

    it("treats a quoted block-comment marker as data", () => {
      expect(
        buildExplainQuery(`SELECT count() FROM stored_spans WHERE name = '/* not a comment */'`).ok,
      ).toBe(true);
    });
  });
});

describe("stripCommentsAndStrings", () => {
  it("drops block comments", () => {
    expect(stripCommentsAndStrings("SELECT /* x */ 1")).toMatch(/SELECT\s+\s+1/);
  });
  it("drops line comments", () => {
    expect(stripCommentsAndStrings("SELECT 1 -- trailing\nFROM x")).not.toMatch(/trailing/);
  });
  it("collapses string literals", () => {
    expect(stripCommentsAndStrings("SELECT 'abc', \"def\" FROM x")).toMatch(/SELECT '', "" FROM x/);
  });
  it("handles nested block comments", () => {
    const out = stripCommentsAndStrings("WHERE 1=1 /* outer /* inner */ TenantId = 'p_fake' */");
    expect(out).not.toMatch(/TenantId/i);
    expect(out).not.toMatch(/p_fake/);
  });
  it("does NOT open a block comment for /* inside a string literal", () => {
    const out = stripCommentsAndStrings(
      `SELECT * FROM x WHERE '/*' = 'y' OR id IN (SELECT id FROM url('http://h/', CSV))`,
    );
    expect(out).toMatch(/url\s*\(/i);
  });
  it("consumes to EOF on an unbalanced opener", () => {
    const out = stripCommentsAndStrings("SELECT 1 /* unterminated TenantId = 'p_x'");
    expect(out).toMatch(/SELECT 1/);
    expect(out).not.toMatch(/TenantId/i);
  });
});

describe("redactQueryForAudit", () => {
  it("strips quoted string literals", () => {
    const { shape } = redactQueryForAudit(
      "SELECT * FROM events WHERE TenantId = 'p_acme' AND email = 'alice@example.com'",
    );
    expect(shape).toContain("TenantId = '?'");
    expect(shape).not.toContain("p_acme");
    expect(shape).not.toContain("alice");
  });
  it("strips numeric literals", () => {
    const { shape } = redactQueryForAudit("SELECT * FROM x WHERE id = 12345");
    expect(shape).not.toMatch(/\b12345\b/);
  });
  it("returns a stable 16-char sha256 prefix", () => {
    const a = redactQueryForAudit("SELECT 1 FROM x");
    const b = redactQueryForAudit("SELECT 1 FROM x");
    expect(a.sha256).toBe(b.sha256);
    expect(a.sha256).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("getOpsClickHouseClient", () => {
  const saved = process.env.CLICKHOUSE_OPS_URL;
  beforeEach(() => {
    _resetOpsClickHouseClientForTesting();
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.CLICKHOUSE_OPS_URL;
    else process.env.CLICKHOUSE_OPS_URL = saved;
    _resetOpsClickHouseClientForTesting();
  });

  it("returns null when CLICKHOUSE_OPS_URL is unset", () => {
    delete process.env.CLICKHOUSE_OPS_URL;
    expect(getOpsClickHouseClient()).toBeNull();
  });

  it("builds and caches a client when set", () => {
    process.env.CLICKHOUSE_OPS_URL = "http://langwatch_ops:secret@ch.example:8123/langwatch";
    const a = getOpsClickHouseClient();
    const b = getOpsClickHouseClient();
    expect(a).not.toBeNull();
    expect(b).toBe(a);
  });
});
