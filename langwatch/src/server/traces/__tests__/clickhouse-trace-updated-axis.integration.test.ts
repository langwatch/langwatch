/**
 * Mechanism-level integration coverage for the updated date-axis keyset
 * pagination (Track 1, API Export Traces RFC). The seam with
 * projection-search.integration.test.ts: that file proves the projected OUTPUT
 * shape; this file proves the QUERY MECHANISM the updated axis relies on —
 *
 *   - the dedup collapses every version of a trace to its GLOBAL latest
 *     (max UpdatedAt across all versions), then applies the window/cursor to
 *     that aggregate — so a trace whose latest version moved past the window is
 *     excluded even if an older version falls inside it (no double-emit across
 *     adjacent CDC windows), and
 *   - the HAVING-on-max(UpdatedAt) cursor seek paginates completely: each trace
 *     surfaces exactly once across pages, ordered by its latest UpdatedAt.
 *
 * This is the subtle correctness the occurred axis gets "for free" (OccurredAt
 * is immutable per trace) but the updated axis must enforce explicitly, because
 * UpdatedAt is the mutable RMT version column.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { getClickHouseClientForProject } from "~/server/clickhouse/clickhouseClient";
import { prisma } from "~/server/db";
import type { Protections } from "../../elasticsearch/protections";
import {
  startTestContainers,
  stopTestContainers,
} from "../../event-sourcing/__tests__/integration/testContainers";
import { ClickHouseTraceService } from "../clickhouse-trace.service";
import type {
  GetAllTracesForProjectInput,
  TracesForProjectResult,
} from "../types";

vi.mock("~/server/clickhouse/clickhouseClient", () => ({
  getClickHouseClientForProject: vi.fn(),
}));

vi.mock("~/server/db", () => ({
  prisma: {
    project: { findUnique: vi.fn().mockResolvedValue({}) },
    annotation: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

const tenantId = `test-updated-axis-${nanoid()}`;
const now = Date.now();
const SECOND = 1000;
const ONE_DAY = 24 * 60 * 60 * 1000;

const openProtections: Protections = {
  canSeeCosts: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
};

// Distinct traces, each inserted as MULTIPLE versions (same TraceId, same
// OccurredAt, increasing UpdatedAt) — exactly what re-ingestion / late
// evaluations / metadata patches produce. The latest-UpdatedAt version is the
// one the dedup must keep, and its UpdatedAt is the updated-axis sort key.
const traceA = `trace-a-${nanoid()}`;
const traceB = `trace-b-${nanoid()}`;
const traceC = `trace-c-${nanoid()}`;
// Its latest version moved AFTER the query window; an older version sits inside
// it. Global-max dedup must EXCLUDE it (in-window-max dedup would wrongly keep
// it, re-emitting it in a later CDC window).
const traceLateBumped = `trace-late-${nanoid()}`;
// Isolated tenant for the filter-drift regression: a trace whose STALE version
// matches a search term the LATEST version no longer does. On the updated axis
// the filter must evaluate on the latest version (dedup-first-then-filter), so
// the trace is excluded. Separate tenant to not perturb the ordering assertions.
const filterTenant = `test-filter-drift-${nanoid()}`;
const traceFilterDrift = `trace-drift-${nanoid()}`;

// Latest UpdatedAt per in-window trace → expected updated-axis order (desc).
const latest: Record<string, number> = {
  [traceA]: now - 20 * SECOND,
  [traceB]: now - 10 * SECOND,
  [traceC]: now - 15 * SECOND,
};
const expectedOrder = [traceB, traceC, traceA];

function makeTraceSummaryRow(traceId: string, updatedAt: number) {
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
  overrides: Partial<GetAllTracesForProjectInput> = {},
): GetAllTracesForProjectInput {
  return {
    projectId: tenantId,
    // Window applies to UpdatedAt on the updated axis; the in-window traces all
    // fall inside, the late-bumped trace's latest version is past endDate.
    startDate: now - 60 * SECOND,
    endDate: now + 60 * SECOND,
    filters: {},
    pageSize: 100,
    sortDirection: "desc",
    ...overrides,
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

async function fetchUpdatedAxisPage(
  pageSize: number,
  scrollId?: string | null,
): Promise<TracesForProjectResult> {
  const results = await service.getAllTracesForProject(
    makeQueryInput({ pageSize }),
    openProtections,
    { downloadMode: true, dateField: "updated", scrollId },
  );
  expect(results).not.toBeNull();
  return results as TracesForProjectResult;
}

function traceIdsOf(result: TracesForProjectResult): string[] {
  return result.groups.flat().map((t) => t.trace_id);
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

  // Each in-window trace has several versions with increasing UpdatedAt — the
  // dedup must collapse them to the latest. An earlier version of B sits BETWEEN
  // C's and A's latest, so a pre-dedup keyset seek (raw UpdatedAt) would
  // mis-place it. The late-bumped trace has an in-window version plus a much
  // later one that the global-max dedup must use to exclude it.
  await insert([
    makeTraceSummaryRow(traceA, now - 40 * SECOND),
    makeTraceSummaryRow(traceA, latest[traceA] as number),
    makeTraceSummaryRow(traceB, now - 18 * SECOND),
    makeTraceSummaryRow(traceB, latest[traceB] as number),
    makeTraceSummaryRow(traceC, now - 30 * SECOND),
    makeTraceSummaryRow(traceC, latest[traceC] as number),
    makeTraceSummaryRow(traceLateBumped, now - 25 * SECOND),
    makeTraceSummaryRow(traceLateBumped, now + ONE_DAY),
  ]);

  // Filter-drift trace (isolated tenant): stale version contains "needle", the
  // latest version does not. Both in-window. On the updated axis the search
  // must run on the LATEST version → "needle" excludes it, "moved" includes it.
  await insert([
    {
      ...makeTraceSummaryRow(traceFilterDrift, now - 30 * SECOND),
      TenantId: filterTenant,
      ComputedInput: JSON.stringify({
        type: "text",
        value: "needle in the older version",
      }),
    },
    {
      ...makeTraceSummaryRow(traceFilterDrift, now - 10 * SECOND),
      TenantId: filterTenant,
      ComputedInput: JSON.stringify({
        type: "text",
        value: "moved on in the latest version",
      }),
    },
  ]);
}, 60_000);

afterAll(async () => {
  if (ch) {
    for (const t of [tenantId, filterTenant]) {
      await ch.exec({
        query:
          "ALTER TABLE trace_summaries DELETE WHERE TenantId = {tenantId:String}",
        query_params: { tenantId: t },
      });
    }
  }
  await stopTestContainers();
});

describe("updated date-axis pagination (integration)", () => {
  describe("given traces inserted as multiple versions", () => {
    describe("when fetched in a single page on the updated axis", () => {
      /** @scenario Updated axis returns everything modified within the window */
      it("collapses each trace to its latest version, ordered by UpdatedAt desc", async () => {
        const page = await fetchUpdatedAxisPage(100);

        // Each in-window trace appears once — not once per version.
        expect(traceIdsOf(page)).toEqual(expectedOrder);

        // The surviving version is the global latest (max UpdatedAt).
        for (const trace of page.groups.flat()) {
          expect(trace.timestamps.updated_at).toBe(latest[trace.trace_id]);
        }
      });

      it("excludes a trace whose latest version moved past the window", async () => {
        const page = await fetchUpdatedAxisPage(100);
        // traceLateBumped has an in-window version (now-25s) but its global max
        // (now + 1 day) is outside the window — global-max dedup drops it.
        expect(traceIdsOf(page)).not.toContain(traceLateBumped);
      });
    });
  });

  describe("given more in-window traces than fit on one page", () => {
    describe("when paginating the updated axis via scrollId", () => {
      /** @scenario Updated axis pagination is complete and at-least-once */
      /** @scenario Projection works with keyset cursor pagination */
      it("returns every trace exactly once across pages, with no duplicates or skips", async () => {
        const seen: string[] = [];
        let scrollId: string | undefined;
        // pageSize 2 over 3 in-window traces → page 1 (B, C) + page 2 (A).
        for (let guard = 0; guard < 5; guard++) {
          const page = await fetchUpdatedAxisPage(2, scrollId);
          seen.push(...traceIdsOf(page));
          scrollId = page.scrollId;
          if (!scrollId) break;
        }

        expect(seen).toEqual(expectedOrder);
        expect(new Set(seen).size).toBe(seen.length);
        expect(seen).not.toContain(traceLateBumped);
      });
    });
  });

  // Regression for the dedup-then-filter fix: filters/search must evaluate on
  // the trace's LATEST version, not any stale version. Before the fix, a stale
  // version matching the search would wrongly include the trace.
  describe("given a trace whose latest version no longer matches a search term", () => {
    const fetchDrift = (query: string) =>
      service.getAllTracesForProject(
        makeQueryInput({ projectId: filterTenant, query }),
        openProtections,
        { downloadMode: true, dateField: "updated" },
      );

    describe("when the search term only matches the stale version", () => {
      it("excludes the trace (search runs on the latest version)", async () => {
        const res = await fetchDrift("needle");
        expect(res).not.toBeNull();
        expect(
          (res as TracesForProjectResult).groups.flat().map((t) => t.trace_id),
        ).not.toContain(traceFilterDrift);
      });
    });

    describe("when the search term matches the latest version", () => {
      it("includes the trace", async () => {
        const res = await fetchDrift("moved");
        expect(res).not.toBeNull();
        expect(
          (res as TracesForProjectResult).groups.flat().map((t) => t.trace_id),
        ).toContain(traceFilterDrift);
      });
    });
  });
});
