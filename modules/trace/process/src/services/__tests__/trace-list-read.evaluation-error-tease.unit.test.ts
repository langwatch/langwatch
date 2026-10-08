/**
 * @vitest-environment node
 */
import { teaserOf, type TraceSummaryData } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { CLICKHOUSE_FACET_CATALOG } from "../../repositories/clickhouse/clickhouse.trace-facet-registry.mapper.ts";
import { TraceListService } from "../trace-list-read.service.ts";

const CUTOFF_MS = 1_700_050_000_000;
const ERROR_TEXT = "e".repeat(300);

function row(overrides: Partial<TraceSummaryData>): TraceSummaryData {
  return {
    traceId: "trace_1",
    spanCount: 1,
    totalDurationMs: 0,
    computedInput: null,
    computedOutput: null,
    timeToFirstTokenMs: null,
    containsErrorStatus: false,
    errorMessage: null,
    models: [],
    totalCost: null,
    nonBilledCost: null,
    tokensEstimated: false,
    totalPromptTokenCount: null,
    totalCompletionTokenCount: null,
    rootSpanType: null,
    attributes: {},
    traceName: "",
    occurredAt: 0,
    createdAt: 0,
    updatedAt: 0,
    LastEventOccurredAt: 0,
    ...overrides,
  } as TraceSummaryData;
}

function erroredSummary(traceId: string) {
  return {
    evaluationId: `eval_${traceId}`,
    evaluatorId: "monitor-1",
    evaluatorType: "test/evaluator",
    evaluatorName: "Test Evaluator",
    traceId,
    isGuardrail: false,
    status: "error" as const,
    score: null,
    passed: null,
    label: null,
    error: ERROR_TEXT,
  };
}

async function readPage() {
  const service = TraceListService.create({
    discoverUpdates: { publishProjectEvent: async () => {} },
    facets: CLICKHOUSE_FACET_CATALOG,
    repository: {
      listAll: vi.fn().mockResolvedValue({
        rows: [
          row({ traceId: "trace_old", occurredAt: CUTOFF_MS - 1_000 }),
          row({ traceId: "trace_new", occurredAt: CUTOFF_MS + 1_000 }),
        ],
        totalHits: 2,
      }),
    } as never,
    evaluations: {
      findSummariesByTraceIds: vi.fn().mockResolvedValue({
        trace_old: [erroredSummary("trace_old")],
        trace_new: [erroredSummary("trace_new")],
      }),
    } as never,
    topicNames: { findNamesByIds: vi.fn().mockResolvedValue(new Map()) } as never,
  });
  return service.getList({
    tenantId: "tenant-1",
    timeRange: { from: 1_700_000_000_000, to: 1_700_086_400_000 },
    sort: { columnId: "timestamp", direction: "desc" },
    pageSize: 50,
    visibilityCutoffMs: CUTOFF_MS,
  });
}

describe("TraceListService.getList evaluation error text", () => {
  describe("given an errored run on a trace past the visibility window", () => {
    /** @scenario "An errored run on a trace past the visibility window shows only a teaser of its error text" */
    it("carries only the teaser of its error text", async () => {
      const page = await readPage();

      expect(page.evaluations.trace_old?.[0]?.error).toBe(teaserOf(ERROR_TEXT));
      expect(page.evaluations.trace_old?.[0]?.error).not.toBe(ERROR_TEXT);
    });
  });

  describe("given an errored run on a trace inside the window", () => {
    it("carries its error text whole", async () => {
      const page = await readPage();

      expect(page.evaluations.trace_new?.[0]?.error).toBe(ERROR_TEXT);
    });
  });
});
