import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import explainHandler, {
  _resetOpsClickHouseClientForTesting,
  buildExplainQuery,
  getOpsClickHouseClient,
  redactQueryForAudit,
  stripCommentsAndStrings,
} from "../explain";
import type { NextApiRequest, NextApiResponse } from "~/types/next-stubs";

// A minimal SELECT used as the "valid baseline" everywhere we need an
// otherwise-acceptable shape so the test is exercising the OTHER
// rejection paths in isolation.
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

  it("does not reject a forbidden keyword that only appears inside a string literal", () => {
    // The previous behaviour was a noted false-positive ("DELETE" inside
    // a string literal triggered the forbidden-keyword regex). After the
    // bypass-fix that normalizes the query before checking, strings are
    // collapsed first, so this query is correctly accepted.
    const q = "SELECT * FROM foo WHERE bar = 'DELETE' AND TenantId = 'p_x'";
    const r = buildExplainQuery(q);
    expect(r.ok).toBe(true);
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

  it("accepts an unscoped (cross-tenant) query — operator endpoint by design", () => {
    // The agent legitimately runs cross-tenant EXPLAINs to find slow query
    // shapes across the whole fleet. The boundary is the langwatch_ops
    // user (no SOURCES, scoped SELECT), not the input text. Enforcing a
    // TenantId predicate here would block half the agent's job.
    const r = buildExplainQuery("SELECT count() FROM stored_spans");
    expect(r.ok).toBe(true);
  });

  // The reviewer's bypass repros — these checks are why we normalize before
  // running the regex pass. Without stripCommentsAndStrings, all of these
  // would slip through.
  describe("comment / string-literal bypasses (reviewer regressions)", () => {
    it("rejects table functions hidden behind a block comment", () => {
      // `url/**/(` — `\burl\s*\(` doesn't see the `/* */` between `url`
      // and `(`, so without normalization this slipped through to
      // ClickHouse where it would have executed the SSRF.
      const q = `SELECT * FROM url/**/('http://127.0.0.1:9/', CSV) WHERE TenantId = 'p_x'`;
      const r = buildExplainQuery(q);
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/table function/i);
    });

    it("rejects table functions hidden behind a line comment", () => {
      const q = `SELECT * FROM url --evil\n('http://x', CSV) WHERE TenantId = 'p_x'`;
      const r = buildExplainQuery(q);
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/table function/i);
    });

    it("rejects deeper nested block comments hiding a forbidden keyword", () => {
      // Three levels of nesting. The lexer must track depth.
      const q = `SELECT 1 FROM stored_spans /* a /* b /* DROP TABLE foo */ */ */ WHERE TenantId = 'p_x'`;
      const r = buildExplainQuery(q);
      expect(r.ok).toBe(true);
    });

    it("rejects a string-opener-inside-string bypass (P2a, reviewer regression)", () => {
      // Reviewer repro: a quoted `/*` followed by a live `url(...)` call.
      // The OLD normalizer stripped block comments BEFORE strings, so it
      // saw `/*` inside the first string as a phantom comment opener and
      // swallowed everything after — including the table function. The
      // integrated lexer tracks string state first, so the `/*` inside
      // the quotes stays inside the quotes and the table-function check
      // sees the live `url(...)`.
      const q = `SELECT * FROM stored_spans WHERE '/*' = 'literal' OR SpanId IN (SELECT SpanId FROM url('http://127.0.0.1:9/', CSV)) /* trailing */`;
      const r = buildExplainQuery(q);
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/table function/i);
    });

    it("treats a quoted block-comment marker as data, not a comment", () => {
      // Sanity: a query that legitimately compares against a string
      // containing `/*` runs fine.
      const q = `SELECT count() FROM stored_spans WHERE name = '/* not a comment */'`;
      const r = buildExplainQuery(q);
      expect(r.ok).toBe(true);
    });

    it("handles escaped quotes via backslash and doubling", () => {
      // ClickHouse accepts both `\'` and `''` inside a single-quoted
      // string. The lexer must close on the OUTER quote, not the
      // escaped one — otherwise a later `'` would prematurely re-open
      // string state and let regex see the wrong thing.
      const q1 = `SELECT name FROM stored_spans WHERE name = 'it\\'s fine'`;
      const q2 = `SELECT name FROM stored_spans WHERE name = 'it''s fine'`;
      expect(buildExplainQuery(q1).ok).toBe(true);
      expect(buildExplainQuery(q2).ok).toBe(true);
    });

    it("rejects an obviously-DROP query even when split by a comment", () => {
      // `DROP/**/TABLE` — the parser ignores the block comment, our regex
      // pass should too. After normalization this becomes `DROP TABLE foo`
      // which trips FORBIDDEN_KEYWORD_RE on DROP.
      const q = `DROP/**/TABLE stored_spans`;
      const r = buildExplainQuery(q);
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/forbidden keyword/i);
    });

    it("still rejects bypasses that collapse to a different rejection path", () => {
      // `INS/**/ERT INTO ... VALUES (1)`: after stripping the comment we
      // have `INS ERT INTO stored_spans VALUES (1)`. The forbidden-keyword
      // check no longer trips (neither `INS` nor `ERT` is on the list),
      // but `VALUES (` is itself a ClickHouse table function and is on
      // the table-function deny-list, so the query is still rejected.
      // This test pins the layered-defense behaviour so a future regex
      // tweak doesn't accidentally open a path through.
      const q = `INS/**/ERT INTO stored_spans VALUES (1)`;
      const r = buildExplainQuery(q);
      expect(r.ok).toBe(false);
    });

    it("does not treat a `;` inside a string literal as multi-statement", () => {
      const q = `SELECT * FROM stored_spans WHERE TenantId = 'p_x' AND name = 'a;b;c'`;
      const r = buildExplainQuery(q);
      expect(r.ok).toBe(true);
    });

    it("does not treat the system.* check as triggered by a string literal", () => {
      // `name = 'system.users'` is data, not a schema reference. Without
      // normalization we'd false-reject this.
      const q = `SELECT * FROM stored_spans WHERE TenantId = 'p_x' AND name = 'system.users'`;
      const r = buildExplainQuery(q);
      expect(r.ok).toBe(true);
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
  it("collapses string literals to empty pairs", () => {
    expect(stripCommentsAndStrings("SELECT 'abc', \"def\" FROM x")).toMatch(/SELECT '', "" FROM x/);
  });
  it("handles escaped quotes inside strings", () => {
    expect(stripCommentsAndStrings(`SELECT 'a\\'b' FROM x`)).toMatch(/SELECT '' FROM x/);
  });
  it("removes /* TenantId = */ entirely so the predicate check is honest", () => {
    expect(stripCommentsAndStrings("WHERE 1=1 /* TenantId = */")).not.toMatch(/TenantId/i);
  });

  it("handles nested block comments by tracking depth (the reviewer repro)", () => {
    // `/* outer /* inner */ TenantId = 'p_fake' */` is one ClickHouse
    // comment; the whole thing should be stripped, no `TenantId` survives.
    const out = stripCommentsAndStrings("WHERE 1=1 /* outer /* inner */ TenantId = 'p_fake' */");
    expect(out).not.toMatch(/TenantId/i);
    expect(out).not.toMatch(/p_fake/);
  });

  it("handles three-level nesting", () => {
    const out = stripCommentsAndStrings("SELECT 1 /* a /* b /* DROP TABLE */ */ */ FROM x");
    expect(out).not.toMatch(/DROP/i);
    expect(out).toMatch(/SELECT 1\s+FROM x/);
  });

  it("consumes to EOF on an unbalanced opener (matches the CH parser)", () => {
    const out = stripCommentsAndStrings("SELECT 1 /* unterminated TenantId = 'p_x'");
    expect(out).toMatch(/SELECT 1/);
    expect(out).not.toMatch(/TenantId/i);
  });

  it("does NOT open a block comment for /* inside a string literal (P2a)", () => {
    // The OLD two-pass stripper ran block comments first, so `'/*'`
    // opened a phantom comment that swallowed live SQL after it.
    // The integrated lexer enters string state on the first `'`, so the
    // `/*` inside the string is data and the live `url(...)` survives
    // for the table-function check.
    const out = stripCommentsAndStrings(
      `SELECT * FROM stored_spans WHERE '/*' = 'x' OR id IN (SELECT id FROM url('http://h/', CSV))`,
    );
    expect(out).toMatch(/url\s*\(/i);
  });

  it("does NOT open a string for ' inside a block comment", () => {
    // Inverse of the bypass above. A bare `'` inside a block comment is
    // not a string opener; the lexer must stay in comment state.
    const out = stripCommentsAndStrings("SELECT 1 /* don't open here */ FROM x");
    expect(out).toMatch(/SELECT 1\s+\s+FROM x/);
  });

  it("handles `''` (doubled-quote) escapes", () => {
    // ClickHouse accepts `''` inside a single-quoted string as an
    // escaped quote.
    const out = stripCommentsAndStrings("SELECT 'it''s fine' FROM x");
    expect(out).toMatch(/SELECT '' FROM x/);
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

describe("getOpsClickHouseClient", () => {
  const savedEnv = process.env.CLICKHOUSE_OPS_URL;

  beforeEach(() => {
    _resetOpsClickHouseClientForTesting();
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.CLICKHOUSE_OPS_URL;
    } else {
      process.env.CLICKHOUSE_OPS_URL = savedEnv;
    }
    _resetOpsClickHouseClientForTesting();
  });

  it("returns null when CLICKHOUSE_OPS_URL is unset — handler falls back to shared client", () => {
    delete process.env.CLICKHOUSE_OPS_URL;
    expect(getOpsClickHouseClient()).toBeNull();
  });

  it("returns null when CLICKHOUSE_OPS_URL is whitespace-only", () => {
    process.env.CLICKHOUSE_OPS_URL = "   ";
    expect(getOpsClickHouseClient()).toBeNull();
  });

  it("builds and caches a client when CLICKHOUSE_OPS_URL is set", () => {
    process.env.CLICKHOUSE_OPS_URL = "http://langwatch_ops:secret@ch.example:8123/langwatch";
    const a = getOpsClickHouseClient();
    const b = getOpsClickHouseClient();
    expect(a).not.toBeNull();
    expect(b).toBe(a);
  });
});

/// Handler-level checks. Only the early-return paths (auth, body, fail-
/// closed) are exercised here — happy-path responses go through the real
/// ClickHouse driver and live in the integration suite. The point of these
/// is to nail down the security boundaries that don't depend on a live DB:
/// auth, prod fail-closed when CLICKHOUSE_OPS_URL is unset, and that the
/// shared client is never invoked when the dedicated client is missing in
/// production. Without those, the regex pass would be the only defense
/// against a leaked API key — which the reviewer flagged as inadequate.
describe("handler", () => {
  const savedOps = process.env.CLICKHOUSE_OPS_URL;
  const savedKey = process.env.LANGWATCH_OPS_API_KEY;
  const savedEnv = process.env.NODE_ENV;

  function mockRes(): NextApiResponse & { _status?: number; _body?: any } {
    const res: any = {};
    res.status = (s: number) => {
      res._status = s;
      return res;
    };
    res.json = (b: any) => {
      res._body = b;
      return res;
    };
    res.setHeader = () => res;
    return res;
  }

  beforeEach(() => {
    _resetOpsClickHouseClientForTesting();
    process.env.LANGWATCH_OPS_API_KEY = "test-key";
  });

  afterEach(() => {
    if (savedOps === undefined) delete process.env.CLICKHOUSE_OPS_URL;
    else process.env.CLICKHOUSE_OPS_URL = savedOps;
    if (savedKey === undefined) delete process.env.LANGWATCH_OPS_API_KEY;
    else process.env.LANGWATCH_OPS_API_KEY = savedKey;
    if (savedEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedEnv;
    vi.restoreAllMocks();
    _resetOpsClickHouseClientForTesting();
  });

  it("returns 503 in production when CLICKHOUSE_OPS_URL is unset — never reaches the shared client", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.CLICKHOUSE_OPS_URL;
    const req = {
      method: "POST",
      headers: { authorization: "Bearer test-key" },
      body: {
        query: "SELECT count() FROM stored_spans WHERE TenantId = 'p_x'",
        type: "PLAN",
      },
    } as unknown as NextApiRequest;
    const res = mockRes();
    await explainHandler(req, res);
    expect(res._status).toBe(503);
    expect(res._body?.message).toMatch(/CLICKHOUSE_OPS_URL/);
    expect(res._body?.message).toMatch(/production/);
  });

  it("returns 401 when LANGWATCH_OPS_API_KEY is unset (fail closed)", async () => {
    delete process.env.LANGWATCH_OPS_API_KEY;
    const req = {
      method: "POST",
      headers: { authorization: "Bearer anything" },
      body: { query: "x" },
    } as unknown as NextApiRequest;
    const res = mockRes();
    await explainHandler(req, res);
    expect(res._status).toBe(401);
  });

  it("returns 401 on a wrong key", async () => {
    const req = {
      method: "POST",
      headers: { authorization: "Bearer not-the-key" },
      body: { query: "x" },
    } as unknown as NextApiRequest;
    const res = mockRes();
    await explainHandler(req, res);
    expect(res._status).toBe(401);
  });

  it("returns 405 on non-POST", async () => {
    const req = {
      method: "GET",
      headers: {},
    } as unknown as NextApiRequest;
    const res = mockRes();
    await explainHandler(req, res);
    expect(res._status).toBe(405);
  });
});
