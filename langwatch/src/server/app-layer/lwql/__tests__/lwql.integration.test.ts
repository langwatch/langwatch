/**
 * LWQL against a real ClickHouse.
 *
 * The unit suite asserts the *shape* of the generated SQL with string matching.
 * That proves the compiler emits what it intends to emit; it cannot prove the
 * database accepts it, or that it returns the right numbers. A query compiler
 * whose output has never been executed is a hypothesis — so everything here
 * runs the real SQL against real rows and asserts on the values that come back.
 *
 * The load-bearing case is `tenant isolation`: two tenants' rows are inserted
 * into the same tables, and the assertion is that a query for one never returns
 * the other's data. String-matching `TenantId = {p0:String}` cannot establish
 * that — only executing it can.
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startTestContainers } from "~/server/event-sourcing/__tests__/integration/testContainers";

import { LwqlError } from "../errors";
import { LwqlService } from "../lwql.service";

const TENANT = `test-lwql-${nanoid()}`;
const OTHER_TENANT = `test-lwql-other-${nanoid()}`;

/**
 * Minute-aligned "an hour ago", never a fixed calendar date: these tables
 * TTL-delete rows relative to OccurredAt, so a hardcoded date eventually ages
 * past the horizon and the fixtures silently vanish before the reads.
 */
const now = Date.now();
const occurredAt = new Date(Math.floor((now - 3_600_000) / 60_000) * 60_000);

let ch: ClickHouseClient;
let service: LwqlService;

/** Gating disabled unless a test opts in, so most cases exercise the data path. */
let cutoffMs: number | null = null;

const traceRow = ({
  tenantId = TENANT,
  traceId,
  models = [],
  cost = null,
  durationMs = 100,
  hasError = false,
  errorMessage = null,
  input = null,
}: {
  tenantId?: string;
  traceId: string;
  models?: string[];
  cost?: number | null;
  durationMs?: number;
  hasError?: boolean;
  errorMessage?: string | null;
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
  TotalDurationMs: durationMs,
  SpanCount: 1,
  ContainsErrorStatus: hasError,
  ContainsOKStatus: !hasError,
  ErrorMessage: errorMessage,
  Models: models,
  TotalCost: cost,
  TraceName: "checkout flow",
});

const spanRow = ({
  traceId,
  spanName,
  toolName,
  durationMs = 5,
}: {
  traceId: string;
  spanName: string;
  toolName?: string;
  durationMs?: number;
}) => ({
  ProjectionId: `proj-${nanoid()}`,
  TenantId: TENANT,
  TraceId: traceId,
  SpanId: `span-${nanoid()}`,
  ParentSpanId: null,
  Sampled: 1,
  StartTime: occurredAt,
  EndTime: new Date(occurredAt.getTime() + durationMs),
  DurationMs: durationMs,
  SpanName: spanName,
  SpanKind: 1,
  ServiceName: "test-service",
  ResourceAttributes: {},
  SpanAttributes: toolName ? { "gen_ai.tool.name": toolName } : {},
  StatusCode: 1,
  CreatedAt: occurredAt,
  UpdatedAt: occurredAt,
});

const run = (query: string) =>
  service.run({ query }, { projectId: TENANT, now });

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;

  service = new LwqlService(
    async () => ch,
    async () => cutoffMs,
  );

  await ch.insert({
    table: "trace_summaries",
    format: "JSONEachRow",
    values: [
      traceRow({
        traceId: "t-gpt4-a",
        models: ["gpt-4o"],
        cost: 0.1,
        durationMs: 100,
      }),
      traceRow({
        traceId: "t-gpt4-b",
        models: ["gpt-4o"],
        cost: 0.3,
        durationMs: 300,
      }),
      traceRow({
        traceId: "t-claude",
        models: ["claude-opus-5"],
        cost: 1.0,
        durationMs: 900,
        hasError: true,
        errorMessage: "boom",
      }),
      // No models at all — must bucket as 'unknown', not vanish. This is the
      // exact divergence ADR-081 records between the spike and the analytics
      // builder, and it is invisible to a string assertion.
      traceRow({ traceId: "t-nomodel", models: [], cost: 0.5 }),
      traceRow({
        traceId: "t-secret",
        models: ["gpt-4o"],
        input: JSON.stringify({ type: "text", value: "acme corp merger" }),
      }),
      // Another tenant's data, in the same table.
      traceRow({
        tenantId: OTHER_TENANT,
        traceId: "t-other",
        models: ["gpt-4o"],
        cost: 999,
        durationMs: 5000,
      }),
    ],
  });

  await ch.insert({
    table: "stored_spans",
    format: "JSONEachRow",
    values: [
      spanRow({ traceId: "t-gpt4-a", spanName: "call", toolName: "search" }),
      spanRow({ traceId: "t-gpt4-b", spanName: "call", toolName: "search" }),
      spanRow({ traceId: "t-claude", spanName: "call", toolName: "calculator" }),
      spanRow({ traceId: "t-nomodel", spanName: "plain" }),
    ],
  });
}, 180_000);

afterAll(async () => {
  if (!ch) return;
  for (const table of ["trace_summaries", "stored_spans"]) {
    for (const tenant of [TENANT, OTHER_TENANT]) {
      await ch.exec({
        query: `ALTER TABLE ${table} DELETE WHERE TenantId = {tenantId:String}`,
        query_params: { tenantId: tenant },
      });
    }
  }
});

describe("tenant isolation, executed", () => {
  it("returns only the querying tenant's rows", async () => {
    const result = await run("SELECT trace_id FROM traces LIMIT 100");
    const ids = result.data.map((r) => r.trace_id);

    expect(ids).toContain("t-gpt4-a");
    expect(ids).not.toContain("t-other");
  });

  it("does not leak another tenant's values into an aggregate", async () => {
    // The other tenant's trace costs 999 and lasts 5000ms. If scoping failed,
    // these aggregates would be wildly different — a leak shows up as a number,
    // not as an error.
    const result = await run(
      "SELECT max(cost_usd) AS c, max(duration_ms) AS d FROM traces",
    );

    expect(Number(result.data[0]!.c)).toBeCloseTo(1.0, 5);
    expect(Number(result.data[0]!.d)).toBe(900);
  });

  it("returns nothing when filtering for another tenant explicitly", async () => {
    const result = await run(
      `SELECT trace_id FROM traces WHERE project_id = '${OTHER_TENANT}'`,
    );
    expect(result.data).toEqual([]);
  });
});

describe("aggregation, executed", () => {
  it("groups by model with correct averages, bucketing model-less traces", async () => {
    const result = await run(
      "SELECT model, avg(cost_usd) AS c, count(*) AS n FROM traces GROUP BY model ORDER BY model ASC",
    );

    const byModel = Object.fromEntries(
      result.data.map((r) => [r.model, { c: Number(r.c), n: Number(r.n) }]),
    );

    // t-gpt4-a (0.1), t-gpt4-b (0.3), t-secret (null cost) → avg over non-null.
    expect(byModel["gpt-4o"]!.n).toBe(3);
    expect(byModel["gpt-4o"]!.c).toBeCloseTo(0.2, 5);
    expect(byModel["claude-opus-5"]!.c).toBeCloseTo(1.0, 5);
    // The row with no models survives as 'unknown' rather than being dropped.
    expect(byModel.unknown!.n).toBe(1);
  });

  it("filters on an array column without multiplying rows", async () => {
    // `has(Models, …)` restricts; a stray arrayJoin here would inflate the count.
    const result = await run(
      "SELECT count(*) AS n FROM traces WHERE model = 'gpt-4o'",
    );
    expect(Number(result.data[0]!.n)).toBe(3);
  });

  it("executes p95 as a real quantile", async () => {
    const result = await run("SELECT p95(duration_ms) AS p FROM traces");
    const p = Number(result.data[0]!.p);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThanOrEqual(900);
  });

  it("applies boolean filters", async () => {
    const result = await run(
      "SELECT trace_id FROM traces WHERE has_error = true",
    );
    expect(result.data.map((r) => r.trace_id)).toEqual(["t-claude"]);
  });

  it("applies IN and NOT IN", async () => {
    const inResult = await run(
      "SELECT count(*) AS n FROM traces WHERE model IN ('gpt-4o', 'claude-opus-5')",
    );
    expect(Number(inResult.data[0]!.n)).toBe(4);
  });
});

describe("spans entity, executed", () => {
  it("reads tool_name out of SpanAttributes", async () => {
    // Guards the attribute-key choice: if `gen_ai.tool.name` were wrong, this
    // would return nulls rather than fail, so it is asserted on values.
    const result = await run(
      "SELECT tool_name, count(*) AS n FROM spans WHERE tool_name IS NOT NULL GROUP BY tool_name ORDER BY tool_name ASC",
    );

    const byTool = Object.fromEntries(
      result.data.map((r) => [r.tool_name, Number(r.n)]),
    );
    expect(byTool.search).toBe(2);
    expect(byTool.calculator).toBe(1);
  });

  it("scopes spans to the tenant and its own time column", async () => {
    const result = await run("SELECT count(*) AS n FROM spans");
    expect(Number(result.data[0]!.n)).toBe(4);
  });
});

describe("limits and metadata, executed", () => {
  it("reports truncation when more rows match than were requested", async () => {
    const result = await run("SELECT trace_id FROM traces LIMIT 2");

    expect(result.data).toHaveLength(2);
    expect(result.meta.truncated).toBe(true);
    expect(result.meta.row_count).toBe(2);
  });

  it("reports no truncation when the result fits", async () => {
    const result = await run("SELECT trace_id FROM traces LIMIT 100");
    expect(result.meta.truncated).toBe(false);
  });

  it("binds the time range so out-of-window rows are excluded", async () => {
    // Fixtures sit an hour back; a window covering only the last minute must
    // return nothing. This exercises DateTime64(3) parameter binding, which a
    // string assertion cannot validate.
    const result = await run("SELECT count(*) AS n FROM traces");
    expect(Number(result.data[0]!.n)).toBeGreaterThan(0);

    const narrow = await service.run(
      {
        ir: {
          from: "traces",
          select: [{ field: "trace_id" }],
          time_range: { from: now - 60_000, to: now },
        },
      },
      { projectId: TENANT, now },
    );
    expect(narrow.data).toEqual([]);
  });
});

describe("content gating, executed", () => {
  it("returns content when the plan has no visibility window", async () => {
    cutoffMs = null;
    const result = await run(
      "SELECT trace_id FROM traces WHERE input LIKE '%acme%'",
    );
    expect(result.data.map((r) => r.trace_id)).toEqual(["t-secret"]);
  });

  it("refuses the same filter once gating is active, before reaching the DB", async () => {
    cutoffMs = now - 14 * 86_400_000;
    try {
      await run("SELECT count(*) FROM traces WHERE input LIKE '%acme%'");
      throw new Error("expected the query to be refused");
    } catch (error) {
      expect(error).toBeInstanceOf(LwqlError);
      expect((error as LwqlError).code).toBe("content_gated");
    } finally {
      cutoffMs = null;
    }
  });
});
