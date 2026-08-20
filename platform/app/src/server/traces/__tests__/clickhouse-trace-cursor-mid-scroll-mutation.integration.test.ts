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

import { getClickHouseClientForTenant } from "~/server/clickhouse/clickhouseClient";
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
  getClickHouseClientForTenant: vi.fn(),
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
// Cursor-tampering scenarios: never mutated after seeding, so page 1 is stable
// no matter when the assertions run.
const tamperTenant = `test-mid-scroll-tamper-${nanoid()}`;
// A trace arrives mid-scroll here; its own tenant so the arrival cannot perturb
// the ordering the other scenarios assert on.
const arrivalTenant = `test-mid-scroll-arrival-${nanoid()}`;

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
const tampered = mkTraceIds();
const arriving = mkTraceIds();

const initialOffsets = { a: -10, b: -20, c: -30, d: -40 } as const;

function makeTraceSummaryRow({
  tenantId,
  traceId,
  updatedAt,
}: {
  tenantId: string;
  traceId: string;
  updatedAt: number;
}) {
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

function makeQueryInput(
  tenantId: string,
  startDate = now - 60 * SECOND,
): GetAllTracesForProjectInput {
  return {
    projectId: tenantId,
    startDate,
    // Deliberately far in the future: a CDC client asking for "everything up to
    // now" produces an endDate at or before the scroll's start, which would
    // hide the boundary the tests below are about. Asking past it is what makes
    // the clamp observable.
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

async function fetchPage({
  tenantId,
  scrollId,
  startDate,
}: {
  tenantId: string;
  scrollId?: string | null;
  startDate?: number;
}): Promise<TracesForProjectResult> {
  const results = await service.getAllTracesForProject(
    makeQueryInput(tenantId, startDate),
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
async function drain({
  tenantId,
  firstPage,
}: {
  tenantId: string;
  firstPage: TracesForProjectResult;
}): Promise<string[]> {
  const seen = [...traceIdsOf(firstPage)];
  let scrollId = firstPage.scrollId;
  for (let guard = 0; guard < 5 && scrollId; guard++) {
    const page = await fetchPage({ tenantId, scrollId });
    seen.push(...traceIdsOf(page));
    scrollId = page.scrollId;
  }
  return seen;
}

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
  vi.mocked(getClickHouseClientForTenant).mockResolvedValue(ch);
  service = new ClickHouseTraceService({
    prisma: prisma as unknown as ConstructorParameters<
      typeof ClickHouseTraceService
    >[0]["prisma"],
  });

  await insert([
    ...(["a", "b", "c", "d"] as const).flatMap((key) => [
      makeTraceSummaryRow({
        tenantId: liveTenant,
        traceId: live[key],
        updatedAt: now + initialOffsets[key] * SECOND,
      }),
      makeTraceSummaryRow({
        tenantId: backdatedTenant,
        traceId: backdated[key],
        updatedAt: now + initialOffsets[key] * SECOND,
      }),
      makeTraceSummaryRow({
        tenantId: tamperTenant,
        traceId: tampered[key],
        updatedAt: now + initialOffsets[key] * SECOND,
      }),
      makeTraceSummaryRow({
        tenantId: arrivalTenant,
        traceId: arriving[key],
        updatedAt: now + initialOffsets[key] * SECOND,
      }),
    ]),
  ]);
}, 60_000);

afterAll(async () => {
  if (ch) {
    for (const t of [
      liveTenant,
      backdatedTenant,
      tamperTenant,
      arrivalTenant,
    ]) {
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
        const page1 = await fetchPage({ tenantId: liveTenant });
        expect(traceIdsOf(page1)).toEqual([live.a, live.b]);
        expect(page1.scrollId).toBeTruthy();
        // What the client is told to expect, captured before anything moves.
        expect(page1.totalHits).toBe(4);

        // A late evaluation / annotation / re-ingestion lands on D. Stamped at
        // write time, which is what a real write does — and necessarily after
        // the scroll began.
        await insert([
          makeTraceSummaryRow({
            tenantId: liveTenant,
            traceId: live.d,
            updatedAt: Date.now() + 5 * SECOND,
          }),
        ]);

        const seen = await drain({ tenantId: liveTenant, firstPage: page1 });

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

    // A characterisation test for an input the ingest path cannot currently
    // produce, NOT a known gap in the fix.
    //
    // The snapshot bound is expressed in UpdatedAt, so it cannot tell a version
    // just written with a past timestamp from one that was always there. That
    // would matter if anything backdated UpdatedAt — and nothing does:
    // abstractFoldProjection stamps `Math.max(Date.now(), prev + 1)`, forced
    // monotonic (projections/abstractFoldProjection.ts), and
    // trace-summary.clickhouse.repository.ts is the only writer of the column.
    // Event occurrence time lives in LastEventOccurredAt, a separate column, so
    // a late or replayed event still moves UpdatedAt forward.
    //
    // This test exists to catch that changing: if a bulk import or backfill
    // ever writes a chosen UpdatedAt, it starts failing and the assumption
    // above needs revisiting rather than quietly rotting.
    describe("when a write is backdated above the cursor", () => {
      it("drops the trace — the bound cannot see write time, and nothing backdates", async () => {
        const page1 = await fetchPage({ tenantId: backdatedTenant });
        expect(traceIdsOf(page1)).toEqual([backdated.a, backdated.b]);

        // Below the scroll start, above the page-1 cursor: a rewrite of history.
        await insert([
          makeTraceSummaryRow({
            tenantId: backdatedTenant,
            traceId: backdated.d,
            updatedAt: now - 15 * SECOND,
          }),
        ]);

        const seen = await drain({
          tenantId: backdatedTenant,
          firstPage: page1,
        });

        // Pin what the scroll DID deliver first. Without this the assertion
        // below passes just as happily on a scroll that returned nothing,
        // which would hide a total breakage as a known limitation.
        expect([...seen].sort()).toEqual(
          [backdated.a, backdated.b, backdated.c].sort(),
        );

        // Asserting CURRENT behaviour against an unreachable input. A failure
        // here means something started backdating UpdatedAt — go read why
        // before changing this assertion.
        expect(seen).not.toContain(backdated.d);
      });
    });
  });

  // The snapshot has an edge, and a client that does not know where it is will
  // walk straight past it. A trace CREATED after the scroll starts has no
  // version at or before the bound, so it is in no page of this scroll — while
  // the requested endDate still stretches beyond it.
  describe("given a trace created after the scroll started", () => {
    describe("when the client resumes from the boundary the response reported", () => {
      it("does not deliver it in this scroll, and does deliver it in the next", async () => {
        const page1 = await fetchPage({ tenantId: arrivalTenant });
        expect(traceIdsOf(page1)).toEqual([arriving.a, arriving.b]);

        // The response has to say where the snapshot stopped, or the client has
        // nothing safe to resume from.
        const boundary = page1.updatedThrough;
        expect(boundary).toBeDefined();
        // Clamped below the requested endDate, which sits an hour out.
        expect(boundary as number).toBeLessThan(now + 60 * 60 * SECOND);

        // A brand new trace lands mid-scroll — one version, stamped now, which
        // is what a real write does.
        const newcomer = `trace-new-${nanoid()}`;
        await insert([
          makeTraceSummaryRow({
            tenantId: arrivalTenant,
            traceId: newcomer,
            // Write time, the way a real write stamps it. The +1ms only
            // guarantees it lands strictly after page one's bound even if both
            // fall in the same millisecond; dating it further ahead would push
            // it past the NEXT pull's bound too, and it would never arrive.
            updatedAt: Date.now() + 1,
          }),
        ]);

        const thisScroll = await drain({
          tenantId: arrivalTenant,
          firstPage: page1,
        });
        expect(thisScroll).not.toContain(newcomer);

        // The next incremental pull starts where this one stopped. Resuming
        // from the requested endDate instead would skip the newcomer forever.
        const nextPull = await fetchPage({
          tenantId: arrivalTenant,
          startDate: boundary,
        });
        expect(traceIdsOf(nextPull)).toContain(newcomer);
      });
    });
  });

  // scrollId is client-supplied, so scrollStart is attacker-controlled and
  // binds as {scrollStart:UInt64}. A non-numeric value must not reach the
  // query — it would fail the whole request rather than degrade.
  describe("given a cursor whose scrollStart has been tampered with", () => {
    const tamper = ({
      scrollId,
      scrollStart,
    }: {
      scrollId: string;
      scrollStart: unknown;
    }) => {
      const cursor = JSON.parse(
        Buffer.from(scrollId, "base64").toString("utf-8"),
      );
      return Buffer.from(JSON.stringify({ ...cursor, scrollStart })).toString(
        "base64",
      );
    };

    for (const [label, value] of [
      ["a string", "not-a-number"],
      ["null", null],
      ["a negative number", -1],
      // Both are finite positives, so a finiteness check waves them through
      // and UInt64 refuses them at the query.
      ["a fraction", 1.5],
      ["beyond the safe integer range", Number.MAX_SAFE_INTEGER + 1],
    ] as const) {
      describe(`when scrollStart is ${label}`, () => {
        it("restarts the scroll instead of failing the query", async () => {
          const page1 = await fetchPage({ tenantId: tamperTenant });
          expect(traceIdsOf(page1)).toEqual([tampered.a, tampered.b]);
          expect(page1.scrollId).toBeTruthy();

          // Must not throw: a rejected cursor degrades to a fresh first page,
          // the same way every other cursor mismatch in that block behaves.
          const page = await fetchPage({
            tenantId: tamperTenant,
            scrollId: tamper({
              scrollId: page1.scrollId as string,
              scrollStart: value,
            }),
          });

          expect(traceIdsOf(page)).toEqual([tampered.a, tampered.b]);
        });
      });
    }
  });
});
