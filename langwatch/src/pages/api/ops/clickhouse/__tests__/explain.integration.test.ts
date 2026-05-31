/**
 * @vitest-environment node
 *
 * Drives the /api/ops/clickhouse/explain handler against a real
 * ClickHouse (via @testcontainers/clickhouse) so the regex normalizer
 * AND the actual ClickHouse parser agree on what's allowed. Unit tests
 * cover the normalizer in isolation; this is what guarantees a query
 * that survives the input filter actually returns sensible EXPLAIN
 * output, and that the wrapping + per-query CH settings round-trip.
 */
import {
  ClickHouseContainer,
  type StartedClickHouseContainer,
} from "@testcontainers/clickhouse";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import explainHandler, {
  _resetOpsClickHouseClientForTesting,
} from "../explain";
import type { NextApiRequest, NextApiResponse } from "~/types/next-stubs";

const API_KEY = "integration-test-key";
let container: StartedClickHouseContainer;

function mockReq(body: any, headers: Record<string, string> = {}): NextApiRequest {
  return {
    method: "POST",
    headers: { authorization: `Bearer ${API_KEY}`, ...headers },
    body,
  } as unknown as NextApiRequest;
}

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

describe("/api/ops/clickhouse/explain (integration)", () => {
  beforeAll(async () => {
    container = await new ClickHouseContainer("clickhouse/clickhouse-server:25.10.2.65")
      .withLabels({ "langwatch.test.explain": "ops" })
      .withReuse()
      .withStartupTimeout(120_000)
      .start();

    // Seed the table the agent's queries shape themselves against. Keep it
    // tiny but real — EXPLAIN PLAN against a missing table returns a CH
    // error, which would tell us nothing about whether our handler works.
    const url = container.getConnectionUrl();
    const { createClient } = await import("@clickhouse/client");
    const c = createClient({ url });
    await c.command({ query: "CREATE DATABASE IF NOT EXISTS langwatch" });
    await c.command({
      query: `CREATE TABLE IF NOT EXISTS langwatch.stored_spans (
        TenantId String,
        SpanId String,
        OccurredAt DateTime,
        SpanAttributes Map(String, String)
      ) ENGINE = MergeTree() ORDER BY (TenantId, OccurredAt)`,
    });
    await c.close();

    process.env.LANGWATCH_OPS_API_KEY = API_KEY;
    process.env.CLICKHOUSE_OPS_URL = url;
    // Pin to a non-production env so the fail-closed path doesn't fire
    // when we explicitly want to test the unset-fallback later.
    process.env.NODE_ENV = "test";
    _resetOpsClickHouseClientForTesting();
  }, 300_000);

  afterAll(async () => {
    delete process.env.LANGWATCH_OPS_API_KEY;
    delete process.env.CLICKHOUSE_OPS_URL;
    _resetOpsClickHouseClientForTesting();
    // Container has `.withReuse()` so we leave it running for the next
    // test run; same pattern the other CH integration tests follow.
  });

  it("returns EXPLAIN PLAN rows for a tenant-scoped SELECT", async () => {
    const res = mockRes();
    await explainHandler(
      mockReq({
        query: "SELECT count() FROM langwatch.stored_spans WHERE TenantId = 'p_test'",
        type: "PLAN",
      }),
      res,
    );
    expect(res._status).toBe(200);
    expect(res._body?.type).toBe("PLAN");
    expect(Array.isArray(res._body?.rows)).toBe(true);
    expect(res._body!.rows.length).toBeGreaterThan(0);
    // EXPLAIN PLAN's first row is the Expression/ReadFromMergeTree/etc
    // pipeline summary — any non-empty string proves we round-tripped
    // through CH, not just our wrapping.
    const firstRowVal = Object.values(res._body!.rows[0])[0];
    expect(typeof firstRowVal).toBe("string");
    expect((firstRowVal as string).length).toBeGreaterThan(0);
  });

  it("accepts a cross-tenant query — operator endpoint by design", async () => {
    // No TenantId predicate; the agent legitimately runs this kind of
    // EXPLAIN to find slow query shapes across the whole fleet. Should
    // round-trip to CH, not 400 on a presence check.
    const res = mockRes();
    await explainHandler(
      mockReq({ query: "SELECT count() FROM langwatch.stored_spans" }),
      res,
    );
    expect(res._status).toBe(200);
  });

  it("honours the EXPLAIN type — PIPELINE returns different rows than PLAN", async () => {
    const planRes = mockRes();
    await explainHandler(
      mockReq({
        query: "SELECT TenantId, count() FROM langwatch.stored_spans GROUP BY TenantId",
        type: "PLAN",
      }),
      planRes,
    );
    expect(planRes._status).toBe(200);

    const pipeRes = mockRes();
    await explainHandler(
      mockReq({
        query: "SELECT TenantId, count() FROM langwatch.stored_spans GROUP BY TenantId",
        type: "PIPELINE",
      }),
      pipeRes,
    );
    expect(pipeRes._status).toBe(200);
    expect(pipeRes._body?.type).toBe("PIPELINE");
    // Crude but enough to prove we passed the type through: PIPELINE
    // text mentions things like "Aggregating" / "AggregatingTransform"
    // that PLAN doesn't.
    const planTxt = JSON.stringify(planRes._body!.rows);
    const pipeTxt = JSON.stringify(pipeRes._body!.rows);
    expect(pipeTxt).not.toBe(planTxt);
  });

  it("rejects a multi-statement query at the input filter, never reaches CH", async () => {
    const res = mockRes();
    await explainHandler(
      mockReq({
        query: "SELECT 1 FROM langwatch.stored_spans WHERE TenantId = 'p_x'; DROP TABLE langwatch.stored_spans",
      }),
      res,
    );
    expect(res._status).toBe(400);
    expect(res._body?.message).toMatch(/single statement/i);
  });

  it("rejects a table function at the input filter (SSRF surface)", async () => {
    const res = mockRes();
    await explainHandler(
      mockReq({
        query: "SELECT * FROM url('http://evil.example/x', CSV, 'a String') WHERE TenantId = 'p_x'",
      }),
      res,
    );
    expect(res._status).toBe(400);
    expect(res._body?.message).toMatch(/table function/i);
  });

  it("rejects the string-vs-comment ordering bypass end-to-end", async () => {
    // Same query that defeated the old normalizer. With the integrated
    // lexer, the `'/*'` stays a string and the live `url(...)` after it
    // is visible to the table-function check.
    const res = mockRes();
    await explainHandler(
      mockReq({
        query: `SELECT * FROM langwatch.stored_spans WHERE '/*' = 'literal' OR SpanId IN (SELECT SpanId FROM url('http://127.0.0.1:9/', CSV)) /* trailing */`,
      }),
      res,
    );
    expect(res._status).toBe(400);
    expect(res._body?.message).toMatch(/table function/i);
  });

  it("rejects a query referencing the system.* schema", async () => {
    const res = mockRes();
    await explainHandler(
      mockReq({ query: "SELECT * FROM system.parts" }),
      res,
    );
    expect(res._status).toBe(400);
    expect(res._body?.message).toMatch(/system/i);
  });

  it("returns 401 without the API key", async () => {
    const res = mockRes();
    await explainHandler(
      {
        method: "POST",
        headers: {}, // no authorization
        body: { query: "SELECT 1 FROM langwatch.stored_spans WHERE TenantId = 'p_x'" },
      } as unknown as NextApiRequest,
      res,
    );
    expect(res._status).toBe(401);
  });

  it("returns 502 with the CH error message when the query is valid SQL but the table is missing", async () => {
    // Proves error propagation: a syntactically valid SELECT against a
    // non-existent table makes CH return an UNKNOWN_TABLE error, and the
    // handler surfaces it without crashing.
    const res = mockRes();
    await explainHandler(
      mockReq({
        query: "SELECT 1 FROM langwatch.does_not_exist_table WHERE TenantId = 'p_x'",
      }),
      res,
    );
    expect(res._status).toBe(502);
    expect(res._body?.message).toMatch(/ClickHouse error/i);
  });

  it("realistic arrayJoin shape — the kind the agent actually runs", async () => {
    // The clickhouse-optimizer skill spells out this shape in its
    // examples; if THIS doesn't pass we've broken the agent's main
    // workload. (No TenantId predicate is fine — operator endpoint.)
    const res = mockRes();
    await explainHandler(
      mockReq({
        query: `SELECT arrayJoin(mapKeys(SpanAttributes)) AS key, count() AS n
                FROM langwatch.stored_spans
                WHERE OccurredAt > now() - INTERVAL 1 DAY
                GROUP BY key ORDER BY n DESC LIMIT 50`,
        type: "PLAN",
      }),
      res,
    );
    expect(res._status).toBe(200);
    expect(res._body?.rows.length).toBeGreaterThan(0);
  });
});
