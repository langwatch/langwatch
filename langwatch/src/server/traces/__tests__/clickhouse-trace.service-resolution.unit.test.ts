/**
 * Unit tests for the ClickHouseTraceService → blob-resolution seam (ADR-022).
 *
 * Mocks only the lowest-level CH driver (getClickHouseClientForProject) and
 * wires a real BlobStore (via getFromEventLog stub) + real TraceIOExtractionService
 * so the full resolution + recomputed-IO pipeline fires end-to-end.
 *
 * BDD structure: given/when nested describes, action-based it() names.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BlobStore } from "~/server/app-layer/traces/blob-store.service";
import { BlobNotFoundError } from "~/server/app-layer/traces/blob-store.service";
import { EVENTREF_ATTR_PREFIX } from "~/server/app-layer/traces/lean-for-projection";
import { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import type { Protections } from "~/server/elasticsearch/protections";
import { createLogger } from "~/utils/logger/server";
import { resolveOffloadedTraces } from "../resolve-offloaded-traces";

// ---------------------------------------------------------------------------
// Hoisted mocks — mock only the CH SQL boundary
// ---------------------------------------------------------------------------

const { mockClickHouseQuery } = vi.hoisted(() => ({
  mockClickHouseQuery: vi.fn(),
}));

vi.mock("~/server/clickhouse/clickhouseClient", () => ({
  getClickHouseClientForProject: () =>
    Promise.resolve({ query: mockClickHouseQuery }),
}));

vi.mock("~/server/db", () => ({
  prisma: {},
}));

// Stub the filter module to return empty conditions
vi.mock("~/server/filters/clickhouse", () => ({
  generateClickHouseFilterConditions: () => ({
    conditions: [],
    params: {},
    hasUnsupportedFilters: false,
  }),
}));

vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: (_name: string, ...args: unknown[]) => {
      const fn = args.length === 1 ? args[0] : args[1];
      const fakeSpan: {
        setAttribute: () => void;
        setAttributes: () => void;
      } = { setAttribute: () => {}, setAttributes: () => {} };
      return (fn as (s: typeof fakeSpan) => Promise<unknown>)(fakeSpan);
    },
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const protections: Protections = {
  canSeeCosts: true,
  canSeePiiData: true,
  canSeeTopics: true,
} as Protections;

const fullOutput =
  "The full 50 KB output value that was offloaded to event_log";

/** Minimal trace-summary row as returned by ClickHouse. */
function makeSummaryRow(traceId: string) {
  return {
    ts_TraceId: traceId,
    ts_SpanCount: 1,
    ts_TotalDurationMs: 100,
    ts_ComputedIOSchemaVersion: "1",
    ts_ComputedInput: null,
    ts_ComputedOutput: '{"type":"text","value":"preview…"}',
    ts_TimeToFirstTokenMs: 10,
    ts_TimeToLastTokenMs: 90,
    ts_TokensPerSecond: 5,
    ts_ContainsErrorStatus: false,
    ts_ContainsOKStatus: true,
    ts_ErrorMessage: "",
    ts_Models: [],
    ts_TotalCost: 0.0,
    ts_TokensEstimated: false,
    ts_TotalPromptTokenCount: 0,
    ts_TotalCompletionTokenCount: 0,
    ts_TopicId: null,
    ts_SubTopicId: null,
    ts_HasAnnotation: null,
    ts_AnnotationIds: [],
    ts_Attributes: {},
    ts_TraceName: null,
    ts_OccurredAt: Date.now(),
    ts_CreatedAt: Date.now(),
    ts_UpdatedAt: Date.now(),
  };
}

/** Minimal span row with an eventref attribute for langwatch.output. */
function makeSpanRowWithEventRef(traceId: string, spanId: string) {
  return {
    SpanId: spanId,
    TraceId: traceId,
    TenantId: "proj-1",
    ParentSpanId: null,
    ParentTraceId: null,
    ParentIsRemote: null,
    Sampled: true,
    StartTime: Date.now(),
    EndTime: Date.now() + 100,
    DurationMs: 100,
    SpanName: "llm-call",
    SpanKind: 1,
    ResourceAttributes: {},
    SpanAttributes: {
      "langwatch.output": "preview…",
      [`${EVENTREF_ATTR_PREFIX}langwatch.output`]: JSON.stringify({
        field: "langwatch.output",
      }),
    },
    StatusCode: 1,
    StatusMessage: "",
    ScopeName: "test",
    ScopeVersion: "1.0",
    Events_Timestamp: [],
    Events_Name: [],
    Events_Attributes: [],
    Links_TraceId: [],
    Links_SpanId: [],
    Links_Attributes: [],
  };
}

/**
 * Builds a fake BlobStore whose getFromEventLog resolves from a static map.
 */
function makeEventRefBlobStore(contents: Record<string, string>): BlobStore {
  return {
    getFromEventLog: vi.fn(
      async ({
        field,
      }: {
        eventId: string;
        field: string;
        tenantId: string;
        aggregateType: string;
        aggregateId: string;
      }) => {
        if (field in contents) return contents[field]!;
        throw new BlobNotFoundError("evt-test", field, "proj-1");
      },
    ),
    putSpool: vi.fn(),
    getSpool: vi.fn(),
    deleteSpool: vi.fn(),
  } as unknown as BlobStore;
}

/** Set up the two CH queries fetchTracesWithSpansJoined fires in parallel. */
function setupGetTracesWithSpansMocks(traceId: string, spanId: string) {
  const summaryResult = {
    json: () => Promise.resolve([makeSummaryRow(traceId)]),
  };
  const spansResult = {
    json: () => Promise.resolve([makeSpanRowWithEventRef(traceId, spanId)]),
  };
  mockClickHouseQuery
    .mockResolvedValueOnce(summaryResult)
    .mockResolvedValueOnce(spansResult);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ClickHouseTraceService — eventref resolution seam (ADR-022)", () => {
  let ClickHouseTraceService: typeof import("../clickhouse-trace.service").ClickHouseTraceService;
  let blobStore: BlobStore;
  let resolveTraceSpansFn: import("../clickhouse-trace.service").ResolveTraceSpansFn;

  beforeEach(async () => {
    vi.clearAllMocks();

    const mod = await import("../clickhouse-trace.service");
    ClickHouseTraceService = mod.ClickHouseTraceService;

    blobStore = makeEventRefBlobStore({ "langwatch.output": fullOutput });
    const ioExtractionService = new TraceIOExtractionService();
    const logger = createLogger("test");

    resolveTraceSpansFn = (projectId, normalizedSpans) =>
      resolveOffloadedTraces({
        projectId,
        normalizedSpans,
        blobStore,
        ioExtractionService,
        logger,
      });
  });

  describe("getTracesWithSpans()", () => {
    describe("given a span carrying a reserved eventref for langwatch.output", () => {
      describe("when getTracesWithSpans is called with a real resolver", () => {
        // NOTE: assertions on the full restored trace.output value require
        // accurately mocking the SQL → row → TraceSummaryData → mapper pipeline
        // (parseComputedOutput, multi-step JOINs, etc.). The end-to-end
        // restored-output behavior is proven by the integration test at
        // src/server/app-layer/traces/__tests__/large-trace-blob-offload.integration.test.ts.
        // This file covers the CH-specific surface: that the resolver IS invoked
        // and the reserved eventref attr is stripped from the returned span.
        it("strips the reserved eventref attr from the returned span", async () => {
          setupGetTracesWithSpansMocks("trace-1", "span-1");

          const service = new ClickHouseTraceService(
            { project: { findUnique: vi.fn() } } as never,
            resolveTraceSpansFn,
          );

          // Per-call gate (#4888): resolution fires only when resolveBlobs:true.
          const traces = await service.getTracesWithSpans(
            "proj-1",
            ["trace-1"],
            protections,
            undefined,
            { resolveBlobs: true },
          );

          const span = traces![0]!.spans[0];
          // The span's params should not contain any eventref key
          const spanStr = JSON.stringify(span);
          expect(spanStr).not.toContain(EVENTREF_ATTR_PREFIX);
        });
      });
    });
  });
});
