/**
 * Does a trace modified DURING a scroll still get delivered?
 *
 * The updated axis exists for incremental / CDC export pulls ("give me
 * everything changed since my last pull"). Its sort key, UpdatedAt, is mutable
 * by definition — that is the whole point of the axis. The keyset cursor,
 * however, is a snapshot: it pins `(lastTimestamp, lastTraceId)` at the moment
 * page N is served, and page N+1 asks for rows strictly beyond that point.
 *
 * So the question this file answers: when a trace that ranked BELOW the page-1
 * cursor is bumped ABOVE it before page 2 is fetched, does the scroll still
 * deliver it?
 *
 *   before:  A(-10s)  B(-20s)  |  C(-30s)  D(-40s)
 *                     ^page-1 cursor lands here
 *   bump:    D is rewritten with a current timestamp — above the cursor
 *   after:   D(now)  A(-10s)  B(-20s)  C(-30s)
 *
 * Without a snapshot bound, D's new position is above the cursor and every
 * later page's threshold only moves further down, so no page can match it and
 * it leaves the scroll entirely.
 *
 * Each scenario owns its tenant. The first one mutates data mid-test on
 * purpose, and a shared tenant would leak that mutation into the next
 * scenario's ordering — which is exactly the class of bug under test.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { getClickHouseClientForProject } from "~/server/clickhouse/clickhouseClient";
import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "../../event-sourcing/__tests__/integration/testContainers";
import { ClickHouseTraceService } from "../clickhouse-trace.service";
import type {
  GetAllTracesForProjectInput,
  TracesForProjectResult,
} from "../types";
import { openProtections } from "./open-protections";

vi.mock("~/server/clickhouse/clickhouseClient", () => ({
  getClickHouseClientForProject: vi.fn(),
}));

vi.mock("~/server/db", () => ({
  prisma: {
    project: { findUnique: vi.fn().mockResolvedValue({}) },
    annotation: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

const SECOND = 1000;
const now = Date.now();

// A trace bumped mid-scroll by a real write, and one bumped by a backdated
// write. They behave differently and each gets its own tenant.
const liveTenant = `test-mid-scroll-live-${nanoid()}`;
const backdatedTenant = `test-mid-scroll-backdated-${nanoid()}`;

const mkTraceIds = () => ({
  a: `trace-a-${nanoid()}`,
  b: `trace-b-${nanoid()}`,
  c: `trace-c-${nanoid()}`,
  // The trace that gets bumped. Starts last, so page 1 cannot contain it and a
  // correct scroll must deliver it on some later page.
  d: `trace-d-${nanoid()}`,
});

const live = mkTraceIds();
const backdated = mkTraceIds();

const initialOffsets = { a: -10, b: -20, c: -30, d: -40 } as const;

function makeTraceSummaryRow(
  tenantId: string,
  traceId: string,
  updatedAt: number,
) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceId,
    Version: "v1",
    Attributes: {},
    // OccurredAt is constant and irrelevant on the updated axis — what varies,
    // and what we page by, is UpdatedAt.
    OccurredAt: new Date(now),
    CreatedAt: new Date(now),
    UpdatedAt: new Date(updatedAt),
    ComputedIOSchemaVersion: "v1",
    ComputedInput: JSON.stringify({ type: "text", value: "in" }),
    ComputedOutput: JSON.stringify({ type: "text", value: "out" }),
    TimeToFirstTokenMs: null,
    TimeToLastTokenMs: null,
    TotalDurationMs: 100,
    TokensPerSecond: null,
    SpanCount: 1,
    ContainsErrorStatus: false,
    ContainsOKStatus: true,
    ErrorMessage: null,
    Models: [],
    TotalCost: 0,
    TokensEstimated: false,
    TotalPromptTokenCount: null,
    TotalCompletionTokenCount: null,
    OutputFromRootSpan: false,
    OutputSpanEndTimeMs: 0,
    BlockedByGuardrail: false,
    SatisfactionScore: null,
    TopicId: null,
    SubTopicId: null,
    HasAnnotation: null,
  };
}

function makeQueryInput(tenantId: string): GetAllTracesForProjectInput {
  return {
    projectId: tenantId,
    startDate: now - 60 * SECOND,
    // Generous upper bound so a bump stamped at write time stays in-window
    // however long the suite takes to reach it.
    endDate: now + 60 * 60 * SECOND,
    filters: {},
    pageSize: 2,
    sortDirection: "desc",
  };
}

let ch: ClickHouseClient;
let service: ClickHouseTraceService;

async function insert(values: Record<string, unknown>[]) {
  await ch.insert({
    table: "trace_summaries",
    values,
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

async function fetchPage(
  tenantId: string,
  scrollId?: string | null,
): Promise<TracesForProjectResult> {
  const results = await service.getAllTracesForProject(
    makeQueryInput(tenantId),
    openProtections,
    { downloadMode: true, dateField: "updated", scrollId },
  );
  // A plain throw rather than expect(): this is a helper, not a test body, and
  // an assertion out here reads as a passing check that never ran.
  if (!results) {
    throw new Error(`getAllTracesForProject returned null for ${tenantId}`);
  }
  return results;
}

function traceIdsOf(result: TracesForProjectResult): string[] {
  return result.groups.flat().map((t) => t.trace_id);
}

/** Walk the scroll to exhaustion from a first page, collecting what it yields. */
async function drain(
  tenantId: string,
  firstPage: TracesForProjectResult,
): Promise<string[]> {
  const seen = [...traceIdsOf(firstPage)];
  let scrollId = firstPage.scrollId;
  for (let guard = 0; guard < 5 && scrollId; guard++) {
    const page = await fetchPage(tenantId, scrollId);
    seen.push(...traceIdsOf(page));
    scrollId = page.scrollId;
  }
  return seen;
}

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
  vi.mocked(getClickHouseClientForProject).mockResolvedValue(ch);
  service = new ClickHouseTraceService(
    prisma as unknown as ConstructorParameters<
      typeof ClickHouseTraceService
    >[0],
  );

  await insert([
    ...(["a", "b", "c", "d"] as const).flatMap((key) => [
      makeTraceSummaryRow(
        liveTenant,
        live[key],
        now + initialOffsets[key] * SECOND,
      ),
      makeTraceSummaryRow(
        backdatedTenant,
        backdated[key],
        now + initialOffsets[key] * SECOND,
      ),
    ]),
  ]);
}, 60_000);

afterAll(async () => {
  if (ch) {
    for (const t of [liveTenant, backdatedTenant]) {
      await ch.exec({
        query:
          "ALTER TABLE trace_summaries DELETE WHERE TenantId = {tenantId:String}",
        query_params: { tenantId: t },
      });
    }
  }
  await stopTestContainers();
});

describe("updated-axis scroll when a trace is modified mid-pagination", () => {
  describe("given a trace ranked below the page-1 cursor", () => {
    describe("when a live write bumps it above the cursor before page 2", () => {
      it("still delivers every in-window trace exactly once across the scroll", async () => {
        const page1 = await fetchPage(liveTenant);
        expect(traceIdsOf(page1)).toEqual([live.a, live.b]);
        expect(page1.scrollId).toBeTruthy();
        // What the client is told to expect, captured before anything moves.
        expect(page1.totalHits).toBe(4);

        // A late evaluation / annotation / re-ingestion lands on D. Stamped at
        // write time, which is what a real write does — and necessarily after
        // the scroll began.
        await insert([
          makeTraceSummaryRow(liveTenant, live.d, Date.now() + 5 * SECOND),
        ]);

        const seen = await drain(liveTenant, page1);

        // D is in the window before and after the bump, so no correct scroll
        // may drop it, and no trace may arrive twice.
        expect(new Set(seen).size).toBe(seen.length);
        expect(seen).toContain(live.d);
        expect([...seen].sort()).toEqual(
          [live.a, live.b, live.c, live.d].sort(),
        );

        // And the count handed out on page 1 must match what the scroll
        // actually delivered — otherwise a shortfall is invisible.
        expect(seen.length).toBe(page1.totalHits);
      });
    });

    // The snapshot bound is expressed in UpdatedAt, and a backdated write is by
    // definition indistinguishable from a version that was always there —
    // nothing in the row records when it was written. So this case is a known
    // residual, documented rather than silently omitted. Closing it needs a
    // separate write-time column, which is a schema change and its own work.
    describe("when a backdated write places it above the cursor", () => {
      it("still drops the trace — known limitation of the snapshot bound", async () => {
        const page1 = await fetchPage(backdatedTenant);
        expect(traceIdsOf(page1)).toEqual([backdated.a, backdated.b]);

        // Below the scroll start, above the page-1 cursor: a rewrite of history.
        await insert([
          makeTraceSummaryRow(backdatedTenant, backdated.d, now - 15 * SECOND),
        ]);

        const seen = await drain(backdatedTenant, page1);

        // Pin what the scroll DID deliver first. Without this the assertion
        // below passes just as happily on a scroll that returned nothing,
        // which would hide a total breakage as a known limitation.
        expect([...seen].sort()).toEqual(
          [backdated.a, backdated.b, backdated.c].sort(),
        );

        // Asserting CURRENT behaviour, not desired behaviour. If this starts
        // failing, the backdated case has been fixed and this should become a
        // positive assertion instead.
        expect(seen).not.toContain(backdated.d);
      });
    });
  });
});
