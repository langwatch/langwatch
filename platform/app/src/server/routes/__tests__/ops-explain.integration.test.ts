/**
 * @vitest-environment node
 *
 * HTTP-level integration test for POST /api/ops/clickhouse/explain.
 *
 * This is the test that should exist from day one — the previous round
 * used `handler(req, res)` direct invocation which sailed past the fact
 * that the route was never bound to a real HTTP path. We import the FULL
 * api-router (not just the ops route module) and exercise it via
 * `router.request()` so a missing `api.route("/", opsApp)` in
 * api-router.ts would show up as a 404 here instead of a green CI and a
 * 404 in production.
 *
 * ClickHouse comes from startTestClickHouseEndpoints: the native local server
 * when one is configured, a container otherwise. Either way the suite gets its
 * own database, so the EXPLAIN targets here can never be confused with, or
 * create a stub table inside, a developer's real `langwatch` database on a
 * shared native server.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { OpsExplainClickHouseRepository } from "~/server/app-layer/ops/repositories/ops-explain.clickhouse.repository";
import { _resetOpsClickHouseClientForTesting } from "~/server/ops/explain-core";
import { OpsExplainService } from "~/server/ops/opsExplain.service";
import { startTestClickHouseEndpoints } from "~/test-utils/clickhouseTestEndpoints";

// The route takes its service from `getApp()`; standing in for the App
// keeps this suite testing the route against a real ClickHouse without
// booting the rest of the application (redis, postgres, event sourcing).
// The repository the service reads through resolves
// `getOpsClickHouseClient()` (or its injected fallback) fresh on every
// call, so a single instance built here behaves exactly like one built per
// request would.
vi.mock("~/server/app-layer/app", () => ({
  // Consumers that degrade without Redis read through this one.
  tryGetApp: () => null,
  getApp: () => ({
    opsExplain: {
      service: new OpsExplainService(
        // The suite always configures CLICKHOUSE_OPS_URL, so the shared-client
        // fallback is never consulted here.
        new OpsExplainClickHouseRepository({ fallbackClient: () => null }),
      ),
    },
  }),
}));

import { createApiRouter } from "~/server/api-router";
import { getApp } from "~/server/app-layer/app";

const API_KEY = "integration-test-key";
/** This suite's database, resolved in beforeAll and templated into every query. */
let DB: string;
let router: ReturnType<typeof createApiRouter>;

async function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return router.request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${API_KEY}`,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/ops/clickhouse/explain (HTTP integration)", () => {
  beforeAll(async () => {
    const [ops] = await startTestClickHouseEndpoints({
      suite: "ops-explain",
      names: ["http"],
    });
    DB = ops!.database;
    const { createClient } = await import("@clickhouse/client");
    const c = createClient({ url: ops!.url });
    await c.command({
      query: `CREATE TABLE IF NOT EXISTS ${DB}.stored_spans (
        TenantId String,
        SpanId String,
        OccurredAt DateTime,
        SpanAttributes Map(String, String)
      ) ENGINE = MergeTree() ORDER BY (TenantId, OccurredAt)`,
    });
    await c.close();

    process.env.LANGWATCH_OPS_API_KEY = API_KEY;
    process.env.CLICKHOUSE_OPS_URL = ops!.url;
    process.env.NODE_ENV = "test";
    _resetOpsClickHouseClientForTesting();

    // Built AFTER env is set so the route module reads the right values
    // on first init.
    router = createApiRouter(getApp());
  }, 300_000);

  afterAll(() => {
    delete process.env.LANGWATCH_OPS_API_KEY;
    delete process.env.CLICKHOUSE_OPS_URL;
    _resetOpsClickHouseClientForTesting();
  });

  it("is mounted at /api/ops/clickhouse/explain and serves EXPLAIN PLAN rows", async () => {
    const res = await post("/api/ops/clickhouse/explain", {
      query: `SELECT count() FROM ${DB}.stored_spans WHERE TenantId = 'p_test'`,
      type: "PLAN",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.type).toBe("PLAN");
    expect(Array.isArray(body.rows)).toBe(true);
    expect(body.rows.length).toBeGreaterThan(0);
  });

  it("accepts a cross-tenant query — operator endpoint by design", async () => {
    const res = await post("/api/ops/clickhouse/explain", {
      query: `SELECT count() FROM ${DB}.stored_spans`,
    });
    expect(res.status).toBe(200);
  });

  it("honours the EXPLAIN type (PIPELINE returns different rows than PLAN)", async () => {
    const plan = await post("/api/ops/clickhouse/explain", {
      query: `SELECT TenantId, count() FROM ${DB}.stored_spans GROUP BY TenantId`,
      type: "PLAN",
    });
    const pipe = await post("/api/ops/clickhouse/explain", {
      query: `SELECT TenantId, count() FROM ${DB}.stored_spans GROUP BY TenantId`,
      type: "PIPELINE",
    });
    expect(plan.status).toBe(200);
    expect(pipe.status).toBe(200);
    const planBody = await plan.json();
    const pipeBody = await pipe.json();
    expect(JSON.stringify(pipeBody)).not.toBe(JSON.stringify(planBody));
  });

  it("rejects a multi-statement query at the input filter (never reaches CH)", async () => {
    const res = await post("/api/ops/clickhouse/explain", {
      query: `SELECT 1 FROM ${DB}.stored_spans WHERE TenantId='x'; DROP TABLE ${DB}.stored_spans`,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/single statement/i);
  });

  it("rejects a table function (SSRF surface)", async () => {
    const res = await post("/api/ops/clickhouse/explain", {
      query:
        "SELECT * FROM url('http://evil.example/x', CSV, 'a String') WHERE TenantId = 'p_x'",
    });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/table function/i);
  });

  it("rejects the string-vs-comment ordering bypass end-to-end", async () => {
    const res = await post("/api/ops/clickhouse/explain", {
      query: `SELECT * FROM ${DB}.stored_spans WHERE '/*' = 'literal' OR SpanId IN (SELECT SpanId FROM url('http://127.0.0.1:9/', CSV)) /* trailing */`,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/table function/i);
  });

  it("rejects the system.* schema", async () => {
    const res = await post("/api/ops/clickhouse/explain", {
      query: "SELECT * FROM system.parts",
    });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/system/i);
  });

  it("returns 401 without the API key", async () => {
    const res = await router.request("/api/ops/clickhouse/explain", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: `SELECT 1 FROM ${DB}.stored_spans WHERE TenantId='x'`,
      }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 with a wrong API key", async () => {
    const res = await post(
      "/api/ops/clickhouse/explain",
      { query: `SELECT 1 FROM ${DB}.stored_spans WHERE TenantId='x'` },
      { authorization: "Bearer totally-wrong" },
    );
    expect(res.status).toBe(401);
  });

  it("returns 405 / does not POST-handle on GET", async () => {
    const res = await router.request("/api/ops/clickhouse/explain", {
      method: "GET",
      headers: { authorization: `Bearer ${API_KEY}` },
    });
    // Hono returns 404 for an unmatched method on an existing path by default;
    // either way the POST handler must NOT run.
    expect([404, 405]).toContain(res.status);
  });

  it("returns 502 on a syntactically valid SELECT against a missing table", async () => {
    const res = await post("/api/ops/clickhouse/explain", {
      query: `SELECT 1 FROM ${DB}.does_not_exist_table WHERE TenantId='x'`,
    });
    expect(res.status).toBe(502);
    expect((await res.json()).message).toMatch(/ClickHouse error/i);
  });

  it("realistic arrayJoin shape the optimizer agent actually runs", async () => {
    const res = await post("/api/ops/clickhouse/explain", {
      query: `SELECT arrayJoin(mapKeys(SpanAttributes)) AS key, count() AS n
              FROM ${DB}.stored_spans
              WHERE OccurredAt > now() - INTERVAL 1 DAY
              GROUP BY key ORDER BY n DESC LIMIT 50`,
      type: "PLAN",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.rows.length).toBeGreaterThan(0);
  });
});
