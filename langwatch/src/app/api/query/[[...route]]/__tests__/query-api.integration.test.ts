/**
 * The LWQL REST endpoint, over the wire, against a real ClickHouse.
 *
 * The service-level integration suite proves the compiler and the SQL. It does
 * not prove the *endpoint*: request validation, the project→tenant handoff, the
 * error-to-HTTP mapping, and the response envelope all live in the route and
 * were previously unexercised. A handler can be wrong in ways the service is
 * right — most usefully, by scoping to something other than the authenticated
 * project.
 *
 * So this drives real HTTP requests through the real Hono app. Only two things
 * are stubbed, and neither is on the path under test: auth (a passthrough that
 * injects the project, exactly as the sibling traces suites do) and the plan
 * store behind visibility gating. The ClickHouse client is the real container.
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { Hono } from "hono";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startTestContainers } from "~/server/event-sourcing/__tests__/integration/testContainers";

/**
 * `~/server/api/security` pulls in `rbac` → `env.mjs`, which validates the
 * environment at import time. The integration harness does not set
 * `LANGWATCH_ENDPOINT`, so the module graph throws before any test runs.
 * `vi.hoisted` executes ahead of the dynamic imports below, which is early
 * enough to satisfy it.
 */
vi.hoisted(() => {
  const defaults: Record<string, string> = {
    LANGWATCH_ENDPOINT: "http://localhost:5560",
    LANGWATCH_NLP_SERVICE: "http://localhost:8080",
    BASE_HOST: "http://localhost:5560",
    NEXTAUTH_URL: "http://localhost:5560",
    NEXTAUTH_SECRET: "integration-test-nextauth-secret",
    API_TOKEN_JWT_SECRET: "integration-test-api-token-secret",
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  };
  // `??=` so a real environment (CI, a configured laptop) always wins; these
  // are only stand-ins for values the route never actually uses.
  for (const [key, value] of Object.entries(defaults)) {
    process.env[key] ??= value;
  }
});

const TENANT = `test-lwql-api-${nanoid()}`;
const OTHER_TENANT = `test-lwql-api-other-${nanoid()}`;

/**
 * Filled in `beforeAll`, read by the mocked resolver below. The mock factory is
 * hoisted above the container start, so it has to reach the client lazily
 * rather than close over a value that does not exist yet.
 */
const holder: { ch?: ClickHouseClient; cutoffMs: number | null } = {
  cutoffMs: null,
};

vi.mock("~/server/clickhouse/clickhouseClient", () => ({
  getClickHouseClientForProject: async () => holder.ch!,
}));

vi.mock("~/server/api/utils", () => ({
  getVisibilityCutoffMsForProject: async () => holder.cutoffMs,
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// The routes register through the SecuredApp builder, whose project strategy
// runs the real auth middleware. Passthrough it and inject the project, so the
// suite exercises the handler with a known tenant rather than real credentials.
vi.mock("~/app/api/middleware/auth", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/app/api/middleware/auth")>();
  return {
    ...actual,
    authMiddleware: async (
      c: { set: (k: string, v: unknown) => void },
      next: () => Promise<void>,
    ) => {
      c.set("project", { id: TENANT, apiKey: "key-test" });
      await next();
    },
    requirePermission: () => async (_c: unknown, next: () => Promise<void>) =>
      next(),
  };
});

const { registerQueryRoutes } = await import("../app.v1");
const { createProjectApp } = await import("~/server/api/security");

const secured = createProjectApp({ basePath: "/" });
registerQueryRoutes(secured);

const testApp = new Hono();
testApp.use("*", async (c, next) => {
  c.set("project" as never, { id: TENANT, apiKey: "key-test" });
  await next();
});
testApp.route("/", secured.hono);

const occurredAt = new Date(
  Math.floor((Date.now() - 3_600_000) / 60_000) * 60_000,
);

const traceRow = ({
  tenantId = TENANT,
  traceId,
  cost,
  models = ["gpt-4o"],
  input = null,
}: {
  tenantId?: string;
  traceId: string;
  cost: number;
  models?: string[];
  input?: string | null;
}) => ({
  ProjectionId: `proj-${nanoid()}`,
  TenantId: tenantId,
  TraceId: traceId,
  Version: "v1",
  Attributes: {},
  OccurredAt: occurredAt,
  CreatedAt: occurredAt,
  UpdatedAt: occurredAt,
  LastEventOccurredAt: occurredAt,
  ComputedIOSchemaVersion: "v1",
  ComputedInput: input,
  ComputedOutput: null,
  TotalDurationMs: 100,
  SpanCount: 1,
  ContainsErrorStatus: false,
  ContainsOKStatus: true,
  Models: models,
  TotalCost: cost,
  TraceName: "checkout flow",
});

const post = (path: string, body: unknown) =>
  testApp.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  const containers = await startTestContainers();
  holder.ch = containers.clickHouseClient;

  await holder.ch.insert({
    table: "trace_summaries",
    format: "JSONEachRow",
    values: [
      traceRow({ traceId: "api-a", cost: 0.2 }),
      traceRow({
        traceId: "api-b",
        cost: 0.4,
        input: JSON.stringify({ type: "text", value: "acme corp merger" }),
      }),
      traceRow({ tenantId: OTHER_TENANT, traceId: "api-other", cost: 999 }),
    ],
  });
}, 180_000);

afterAll(async () => {
  if (!holder.ch) return;
  for (const tenant of [TENANT, OTHER_TENANT]) {
    await holder.ch.exec({
      query: "ALTER TABLE trace_summaries DELETE WHERE TenantId = {t:String}",
      query_params: { t: tenant },
    });
  }
});

describe("POST /api/query over HTTP", () => {
  it("executes text queries and returns the documented envelope", async () => {
    const res = await post("/", {
      query: "SELECT trace_id, cost_usd FROM traces ORDER BY cost_usd ASC",
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Record<string, unknown>[];
      meta: Record<string, unknown>;
    };

    expect(body.data.map((r) => r.trace_id)).toEqual(["api-a", "api-b"]);
    expect(body.meta.row_count).toBe(2);
    expect(body.meta.truncated).toBe(false);
    expect(body.meta.columns).toEqual(["trace_id", "cost_usd"]);
    expect(typeof body.meta.execution_ms).toBe("number");
  });

  it("accepts the structured IR form and agrees with the text form", async () => {
    const res = await post("/", {
      ir: {
        from: "traces",
        select: [{ field: "trace_id" }],
        order_by: [{ field: "trace_id", direction: "asc" }],
      },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown>[] };
    expect(body.data.map((r) => r.trace_id)).toEqual(["api-a", "api-b"]);
  });

  it("scopes to the authenticated project, not to anything in the request", async () => {
    // The other tenant's row costs 999. If the handler passed the wrong id
    // through, this aggregate would say so.
    const res = await post("/", {
      query: "SELECT max(cost_usd) AS c FROM traces",
    });

    const body = (await res.json()) as { data: { c: unknown }[] };
    expect(Number(body.data[0]!.c)).toBeCloseTo(0.4, 5);
  });

  it("never returns generated SQL to an API-key caller", async () => {
    // `explain` is internal-only; a project API key is not an internal caller.
    const res = await post("/", { query: "SELECT trace_id FROM traces" });
    const body = (await res.json()) as { meta: Record<string, unknown> };

    expect(body.meta.sql).toBeUndefined();
    expect(body.meta.params).toBeUndefined();
  });

  it("maps a bad query to 400 with a code and a fix hint", async () => {
    const res = await post("/", { query: "SELECT nope FROM traces" });

    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: { code: string; message: string; hint?: string };
    };
    expect(body.error.code).toBe("unknown_field");
    expect(body.error.message).toContain("nope");
    expect(body.error.hint).toBeTruthy();
  });

  it("reports truncation over the wire", async () => {
    const res = await post("/", {
      query: "SELECT trace_id FROM traces LIMIT 1",
    });

    const body = (await res.json()) as { meta: { truncated: boolean } };
    expect(body.meta.truncated).toBe(true);
  });

  it("refuses a gated field as a filter target once gating is active", async () => {
    holder.cutoffMs = Date.now() - 14 * 86_400_000;
    try {
      const res = await post("/", {
        query: "SELECT count(*) FROM traces WHERE input LIKE '%acme%'",
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("content_gated");
    } finally {
      holder.cutoffMs = null;
    }
  });
});

describe("POST /api/query/validate over HTTP", () => {
  it("returns valid:true with resolved columns and executes nothing", async () => {
    const res = await post("/validate", {
      query: "SELECT model, count(*) AS n FROM traces GROUP BY model",
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { valid: boolean; columns: string[] };
    expect(body.valid).toBe(true);
    expect(body.columns).toEqual(["model", "n"]);
  });

  it("returns 200 valid:false for a bad query, not a transport error", async () => {
    // An editor rendering inline errors must be able to tell "your query is
    // wrong" apart from "the request failed".
    const res = await post("/validate", {
      query: "SELECT trace_id FROM traces ORDER BY",
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      valid: boolean;
      error: { code: string };
    };
    expect(body.valid).toBe(false);
    expect(body.error.code).toBe("parse_error");
  });
});

describe("GET /api/query/catalogue over HTTP", () => {
  it("describes the queryable surface and flags gated fields", async () => {
    const res = await testApp.request("/catalogue");

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entities: {
        entity: string;
        fields: { name: string; content_gated: boolean }[];
        content_gated_fields: string[];
      }[];
    };

    const traces = body.entities.find((e) => e.entity === "traces")!;
    expect(traces.fields.some((f) => f.name === "cost_usd")).toBe(true);
    expect(traces.content_gated_fields).toContain("input");

    // The catalogue describes the language, so it must not leak table names.
    expect(JSON.stringify(body)).not.toContain("trace_summaries");
  });
});
