/**
 * Integration coverage for issue #6356: free-text trace search has to reach
 * span names, not just the captured I/O.
 *
 * Proves `specs/traces-v2/search.feature`'s "Free text matches span names as
 * well as captured I/O" rule against real ClickHouse, for BOTH free-text paths:
 *
 *   Path A, the traces-v2 search bar (also what Langy searches through):
 *            `translateFilterToClickHouse` compiles the query and the generated
 *            SQL is executed here, so an invalid subquery or a mis-bound param
 *            fails the test rather than passing a string assertion.
 *   Path B, the legacy messages list and public search endpoint, driven
 *            through `ClickHouseTraceService.getAllTracesForProject`.
 *
 * The fixtures are built so each trace can only be found through ONE field.
 * A trace whose span name is the sole occurrence of the term is the exact case
 * that used to be invisible, and the "no match anywhere" trace guards against
 * a clause that accidentally matches everything.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { translateFilterToClickHouse } from "~/server/app-layer/traces/filter-to-clickhouse";
import { getClickHouseClientForProject } from "~/server/clickhouse/clickhouseClient";
import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "../../event-sourcing/__tests__/integration/testContainers";
import { ClickHouseTraceService } from "../clickhouse-trace.service";
import type { GetAllTracesForProjectInput } from "../types";
import { openProtections } from "./open-protections";

const tenantId = `test-spanname-${nanoid()}`;
const now = Date.now();

// Each trace carries the term in exactly one place.
const BY_SPAN_NAME = `trace-by-span-${nanoid()}`;
const BY_TRACE_NAME = `trace-by-name-${nanoid()}`;
const BY_INPUT = `trace-by-input-${nanoid()}`;
const BY_OUTPUT = `trace-by-output-${nanoid()}`;
const NO_MATCH = `trace-no-match-${nanoid()}`;

const TERM = "codex";

function traceRow({
  traceId,
  traceName = "checkout flow",
  input = "nothing relevant here",
  output = "nothing relevant either",
}: {
  traceId: string;
  traceName?: string;
  input?: string | null;
  output?: string | null;
}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceId,
    Version: "v1",
    Attributes: {},
    OccurredAt: new Date(now),
    CreatedAt: new Date(now),
    UpdatedAt: new Date(now),
    LastEventOccurredAt: new Date(now),
    ComputedIOSchemaVersion: "v1",
    ComputedInput:
      input === null ? null : JSON.stringify({ type: "text", value: input }),
    ComputedOutput:
      output === null ? null : JSON.stringify({ type: "text", value: output }),
    TotalDurationMs: 100,
    SpanCount: 1,
    ContainsErrorStatus: false,
    ContainsOKStatus: true,
    Models: [],
    TraceName: traceName,
  };
}

/**
 * `parentSpanId` matters: `TraceName` covers the root span's name, so the
 * subquery only earns its keep on NON-root spans. A fixture where every span is
 * a root would pass on the trace-name branch alone and never exercise it.
 */
function spanRow({
  traceId,
  spanName,
  parentSpanId = null,
}: {
  traceId: string;
  spanName: string;
  parentSpanId?: string | null;
}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceId,
    SpanId: `span-${nanoid()}`,
    ParentSpanId: parentSpanId,
    Sampled: 1,
    StartTime: new Date(now),
    EndTime: new Date(now + 5),
    DurationMs: 5,
    SpanName: spanName,
    SpanKind: 1,
    ServiceName: "test-service",
    ResourceAttributes: {},
    SpanAttributes: {},
    StatusCode: 1,
    CreatedAt: new Date(now),
    UpdatedAt: new Date(now),
  };
}

let ch: ClickHouseClient;
let service: ClickHouseTraceService;

vi.mock("~/server/clickhouse/clickhouseClient", () => ({
  getClickHouseClientForProject: vi.fn(),
}));

vi.mock("~/server/db", () => ({
  prisma: {
    project: { findUnique: vi.fn().mockResolvedValue({}) },
    annotation: { findMany: vi.fn().mockResolvedValue([]) },
    annotationScore: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

/**
 * Path A: compile the free-text query the search bar would send, then RUN the
 * generated SQL against the seeded data and return the trace ids it selects.
 */
async function searchViaCompiledFilter(query: string): Promise<string[]> {
  const compiled = translateFilterToClickHouse(query, tenantId, {
    from: now - 60_000,
    to: now + 60_000,
  });
  // A guard rather than an assertion: this is a helper, not a test body, and
  // a null compile here means the fixture query itself is wrong.
  if (!compiled) throw new Error(`query compiled to no filter: ${query}`);

  const result = await ch.query({
    query: `
      SELECT DISTINCT TraceId
      FROM trace_summaries
      WHERE TenantId = {tenantId:String}
        AND OccurredAt >= fromUnixTimestamp64Milli({timeFrom:Int64})
        AND OccurredAt <= fromUnixTimestamp64Milli({timeTo:Int64})
        AND (${compiled.sql})
    `,
    query_params: compiled.params,
    format: "JSONEachRow",
  });
  const rows = await result.json<{ TraceId: string }>();
  return rows.map((r) => r.TraceId).sort();
}

/** Path B: the legacy list search, all the way through the service. */
async function searchViaLegacyList(query: string): Promise<string[]> {
  const input: GetAllTracesForProjectInput = {
    projectId: tenantId,
    startDate: now - 60_000,
    endDate: now + 60_000,
    filters: {},
    pageSize: 100,
    query,
  } as GetAllTracesForProjectInput;

  const results = await service.getAllTracesForProject(input, openProtections);
  if (!results) throw new Error(`legacy list returned nothing for: ${query}`);
  return results.groups
    .flat()
    .map((t) => t.trace_id)
    .sort();
}

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
  vi.mocked(getClickHouseClientForProject).mockResolvedValue(ch);
  service = new ClickHouseTraceService({
    prisma: prisma as ConstructorParameters<
      typeof ClickHouseTraceService
    >[0]["prisma"],
  });

  await ch.insert({
    table: "trace_summaries",
    values: [
      // The regression case: the term exists ONLY on a child span's name.
      traceRow({ traceId: BY_SPAN_NAME }),
      // The term is the trace name (the root span's name).
      traceRow({ traceId: BY_TRACE_NAME, traceName: `${TERM} exec` }),
      // Controls that already worked before the fix.
      traceRow({ traceId: BY_INPUT, input: `please run ${TERM} for me` }),
      traceRow({ traceId: BY_OUTPUT, output: `${TERM} finished cleanly` }),
      // Must never match.
      traceRow({ traceId: NO_MATCH }),
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });

  await ch.insert({
    table: "stored_spans",
    values: [
      // The regression case, as a genuine CHILD span (its trace's own name is
      // "checkout flow", so only the subquery can find it) and mixed case on
      // purpose, since matching must be case-insensitive.
      spanRow({ traceId: BY_SPAN_NAME, spanName: "root" }),
      spanRow({
        traceId: BY_SPAN_NAME,
        spanName: "Codex.Exec",
        parentSpanId: "span-root-checkout",
      }),
      spanRow({ traceId: BY_TRACE_NAME, spanName: "http.request" }),
      spanRow({ traceId: BY_INPUT, spanName: "http.request" }),
      spanRow({ traceId: BY_OUTPUT, spanName: "http.request" }),
      spanRow({ traceId: NO_MATCH, spanName: "http.request" }),
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}, 120_000);

afterAll(async () => {
  if (ch) {
    for (const table of ["trace_summaries", "stored_spans"]) {
      await ch.exec({
        query: `ALTER TABLE ${table} DELETE WHERE TenantId = {tenantId:String}`,
        query_params: { tenantId },
      });
    }
  }
  await stopTestContainers();
});

describe("free-text search over span names (integration)", () => {
  describe("given a trace whose span name is the only place the term appears", () => {
    // Guards the fixture itself: if the matching span were a root, the
    // trace-name branch could carry these tests and the subquery would go
    // untested. Its trace is named "checkout flow", so only the subquery matches.
    it("has the matching span as a non-root span", async () => {
      const rows = await (
        await ch.query({
          query: `SELECT SpanName, isNull(ParentSpanId) AS is_root
                  FROM stored_spans
                  WHERE TenantId = {tenantId:String} AND TraceId = {traceId:String}
                    AND lower(SpanName) LIKE '%codex%'`,
          query_params: { tenantId, traceId: BY_SPAN_NAME },
          format: "JSONEachRow",
        })
      ).json<{ SpanName: string; is_root: number }>();

      expect(rows).toHaveLength(1);
      expect(rows[0]!.SpanName).toBe("Codex.Exec");
      expect(Number(rows[0]!.is_root)).toBe(0);
    });

    it("surfaces it through the traces-v2 search bar", async () => {
      const found = await searchViaCompiledFilter(TERM);
      expect(found).toContain(BY_SPAN_NAME);
    });

    it("surfaces it through the legacy list search", async () => {
      const found = await searchViaLegacyList(TERM);
      expect(found).toContain(BY_SPAN_NAME);
    });
  });

  describe("given a trace whose name is the only place the term appears", () => {
    it("surfaces it through the traces-v2 search bar", async () => {
      const found = await searchViaCompiledFilter(TERM);
      expect(found).toContain(BY_TRACE_NAME);
    });

    it("surfaces it through the legacy list search", async () => {
      const found = await searchViaLegacyList(TERM);
      expect(found).toContain(BY_TRACE_NAME);
    });
  });

  describe("when the term is searched", () => {
    it("still finds the captured I/O matches it always found", async () => {
      const found = await searchViaCompiledFilter(TERM);
      expect(found).toContain(BY_INPUT);
      expect(found).toContain(BY_OUTPUT);
    });

    it("finds every matching trace and nothing else", async () => {
      const found = await searchViaCompiledFilter(TERM);
      expect(found).toEqual(
        [BY_SPAN_NAME, BY_TRACE_NAME, BY_INPUT, BY_OUTPUT].sort(),
      );
    });

    it("leaves a trace with no occurrence anywhere out", async () => {
      expect(await searchViaCompiledFilter(TERM)).not.toContain(NO_MATCH);
      expect(await searchViaLegacyList(TERM)).not.toContain(NO_MATCH);
    });
  });

  describe("when the term is negated", () => {
    it("excludes the span-name and trace-name matches", async () => {
      const found = await searchViaCompiledFilter(`NOT ${TERM}`);
      expect(found).not.toContain(BY_SPAN_NAME);
      expect(found).not.toContain(BY_TRACE_NAME);
      // NOT over a trace with non-null, non-matching I/O keeps it in.
      expect(found).toContain(NO_MATCH);
    });
  });

  describe("when a term matches no trace at all", () => {
    it("returns nothing rather than everything", async () => {
      expect(await searchViaCompiledFilter("zzz-nonexistent-zzz")).toEqual([]);
      expect(await searchViaLegacyList("zzz-nonexistent-zzz")).toEqual([]);
    });
  });
});
