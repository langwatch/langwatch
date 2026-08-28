/**
 * Successive pages of the DEFAULT (occurred) axis must not overlap.
 *
 * #6808 acceptance: `pageOffset` is rejected, so `scrollId` is the only way to
 * page trace search — and the guarantee the rejected parameter failed to give
 * (page two is not page one again) now has to be shown for the path that
 * replaced it. The updated axis already had this coverage; the occurred axis,
 * which is what every default export walks, did not.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { TraceCanonicalisationService } from "@langwatch/trace-server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { getClickHouseClientForTenant } from "~/server/clickhouse/clickhouseClient";
import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "../../event-sourcing/__tests__/integration/testContainers";
import { ClickHouseTraceService } from "../clickhouse-trace.service";
const traceCanonicalisation = TraceCanonicalisationService.create();
import type { TracesForProjectResult } from "@langwatch/trace-contract";
import type { GetAllTracesForProjectInput } from "../types";
import { openProtections } from "./open-protections";

vi.mock("~/server/clickhouse/clickhouseClient", () => ({
  getClickHouseClientForTenant: vi.fn(),
}));

// The service resolves its client through getApp().clickhouse now (two-door
// access); this App stub delegates to the clickhouseClient mock above, so
// the suite's existing per-tenant wiring keeps working unchanged.
vi.mock("~/server/app-layer/app", async () => {
  const clients = await import("~/server/clickhouse/clickhouseClient");
  const app = () => ({
    clickhouse: {
      enabled: true,
      resolveClient: (tenantId: string) => clients.getClickHouseClientForTenant(tenantId),
      resolveOrganizationClient: async () => {
        throw new Error("no organization client in this suite");
      },
      allInstances: async () => [],
    },
  });
  return { getApp: app, tryGetApp: app };
});

vi.mock("~/server/db", () => ({
  prisma: {
    project: { findUnique: vi.fn().mockResolvedValue({}) },
    annotation: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

const SECOND = 1000;
const now = Date.now();
const tenantId = `test-occurred-paging-${nanoid()}`;

const TRACE_COUNT = 7;
const PAGE_SIZE = 2;
// Distinct OccurredAt per trace, newest first, so desc order is unambiguous.
const traces = Array.from({ length: TRACE_COUNT }, (_, i) => ({
  traceId: `trace-${String(i).padStart(2, "0")}-${nanoid()}`,
  occurredAt: now - (i + 1) * SECOND,
}));

function makeTraceSummaryRow(traceId: string, occurredAt: number) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceId,
    Version: "v1",
    Attributes: {},
    OccurredAt: new Date(occurredAt),
    CreatedAt: new Date(occurredAt),
    UpdatedAt: new Date(occurredAt),
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

let ch: ClickHouseClient;
let service: ClickHouseTraceService;

function makeQueryInput(): GetAllTracesForProjectInput {
  return {
    projectId: tenantId,
    startDate: now - 60 * SECOND,
    endDate: now + 60 * SECOND,
    filters: {},
    pageSize: PAGE_SIZE,
    sortDirection: "desc",
  };
}

async function fetchPage(scrollId?: string | null): Promise<TracesForProjectResult> {
  const results = await service.getAllTracesForProject(
    makeQueryInput(),
    openProtections,
    // No dateField: the default occurred axis is the point of this file.
    { downloadMode: true, scrollId },
  );
  if (!results) {
    throw new Error("getAllTracesForProject returned null");
  }
  return results;
}

const traceIdsOf = (r: TracesForProjectResult) => r.groups.flat().map((t) => t.trace_id);

/**
 * Walk the scroll to exhaustion, returning what each page yielded, in order.
 *
 * The guard is generously above the real page count: a scroll that never
 * terminates is itself a failure, and the caller's assertions catch it rather
 * than the loop spinning forever.
 */
async function drainPages(): Promise<string[][]> {
  const pages: string[][] = [];
  let scrollId: string | null | undefined;

  for (let page = 0; page < TRACE_COUNT + 3; page++) {
    const result = await fetchPage(scrollId);
    const ids = traceIdsOf(result);
    if (ids.length === 0) break;

    pages.push(ids);
    scrollId = result.scrollId;
    if (!scrollId) break;
  }

  return pages;
}

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
  vi.mocked(getClickHouseClientForTenant).mockResolvedValue(ch);
  service = new ClickHouseTraceService({
    prisma: prisma as unknown as ConstructorParameters<
      typeof ClickHouseTraceService
    >[0]["prisma"],
    traceCanonicalisation,
  });

  await ch.insert({
    table: "trace_summaries",
    values: traces.map((t) => makeTraceSummaryRow(t.traceId, t.occurredAt)),
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}, 60_000);

afterAll(async () => {
  if (ch) {
    await ch.exec({
      query: "ALTER TABLE trace_summaries DELETE WHERE TenantId = {tenantId:String}",
      query_params: { tenantId },
    });
  }
  await stopTestContainers();
});

describe("occurred-axis keyset pagination", () => {
  describe("given more traces than fit on one page", () => {
    describe("when walking the scroll to exhaustion", () => {
      // Deliberately carries no spec-binding annotation: this is a bug fix, and
      // the repo does not open BDD scenarios for those. An annotation naming a
      // title that exists in no feature file binds to nothing, which the parity
      // check reports as a stale reference — correctly.
      it("returns every trace exactly once, in order, with no repeats", async () => {
        const pages = await drainPages();

        // The specific defect #6808 describes: page two is page one again.
        pages.forEach((ids, index) => {
          const earlier = pages.slice(0, index).flat();
          expect(earlier).not.toEqual(expect.arrayContaining(ids));
        });

        const seen = pages.flat();
        expect(new Set(seen).size).toBe(seen.length);
        expect(seen).toEqual(traces.map((t) => t.traceId));
      });
    });

    describe("when the first page is requested twice", () => {
      it("is stable — the same traces, in the same order", async () => {
        // Guards the other direction: a scroll that never advances would also
        // satisfy "no overlap" if each page came back empty.
        const first = traceIdsOf(await fetchPage());
        const again = traceIdsOf(await fetchPage());

        expect(first).toHaveLength(PAGE_SIZE);
        expect(again).toEqual(first);
      });
    });
  });
});
