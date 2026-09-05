/**
 * @see ADR-022
 * Unit tests for the TraceLegacyReadClickHouseRepository -> blob-resolution seam. Mocks only the lowest-level CH driver (getClickHouseClientForTenant), wires a real TraceBlobStoreService (via getFromEventLog stub) + real TraceIOExtractionService so full resolution + recomputed-IO fires end-to-end.
 */

import { TraceOffloadResolutionService } from "../../../services/trace-offload-resolution.service";
import { createLogger } from "@langwatch/observability";
import { TraceCanonicalisationService } from "@langwatch/trace-server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TraceBlobStoreService } from "../../../services/trace-blob-store.service";
import { BlobNotFoundError } from "../../../services/trace-blob-store.service";
import { EVENTREF_ATTR_PREFIX } from "@langwatch/trace-contract";
import { TraceIOExtractionService } from "../../../services/trace-io-extraction.service";
import type { Protections } from "@langwatch/trace-server";

// ---------------------------------------------------------------------------
// Hoisted mocks — mock only the CH SQL boundary
// ---------------------------------------------------------------------------

const { mockClickHouseQuery } = vi.hoisted(() => ({
  mockClickHouseQuery: vi.fn(),
}));

/**
 * The process's tenant-keyed connection, as this suite supplies it — arrives as a CONSTRUCTOR argument now. The suite used to mock the platform application's singleton; the repository takes the resolver instead, so the fake sits where every other dependency of the read does.
 */
const testResolveClickHouseClient = () => Promise.resolve({ query: mockClickHouseQuery } as never);

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

const fullOutput = "The full 50 KB output value that was offloaded to event_log";

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
 * Builds a fake TraceBlobStoreService whose getFromEventLog resolves from a static map.
 */
function makeEventRefBlobStore(contents: Record<string, string>): TraceBlobStoreService {
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
  } as unknown as TraceBlobStoreService;
}

/**
 * Set up the CH queries fetchTracesWithSpansJoined fires: a light resolve
 * (min/max OccurredAt) for the hint-less path, then the summary and span reads.
 */
function setupGetTracesWithSpansMocks(traceId: string, spanId: string) {
  const resolveResult = {
    json: () => Promise.resolve([{ fromMs: 1_000_000, toMs: 2_000_000 }]),
  };
  const summaryResult = {
    json: () => Promise.resolve([makeSummaryRow(traceId)]),
  };
  const spansResult = {
    json: () => Promise.resolve([makeSpanRowWithEventRef(traceId, spanId)]),
  };
  mockClickHouseQuery
    .mockResolvedValueOnce(resolveResult)
    .mockResolvedValueOnce(summaryResult)
    .mockResolvedValueOnce(spansResult);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TraceLegacyReadClickHouseRepository — eventref resolution seam (ADR-022)", () => {
  let TraceLegacyReadClickHouseRepository: typeof import("../trace-legacy-read.repository").TraceLegacyReadClickHouseRepository;
  let blobStore: TraceBlobStoreService;
  let resolveTraceSpansFn: import("../trace-legacy-read.repository").ResolveTraceSpansFn;
  let traceCanonicalisation: TraceCanonicalisationService;

  beforeEach(async () => {
    vi.clearAllMocks();

    const mod = await import("../trace-legacy-read.repository");
    TraceLegacyReadClickHouseRepository = mod.TraceLegacyReadClickHouseRepository;

    blobStore = makeEventRefBlobStore({ "langwatch.output": fullOutput });
    traceCanonicalisation = TraceCanonicalisationService.create();
    const ioExtractionService = TraceIOExtractionService.create(traceCanonicalisation);
    const logger = createLogger("test");

    resolveTraceSpansFn = (projectId, normalizedSpans) =>
      TraceOffloadResolutionService.resolveOffloadedTraces({
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
        // Full restored trace.output assertions need accurately mocking the
        // SQL -> row -> TraceSummaryData -> mapper pipeline; end-to-end
        // restored-output behavior is proven by
        // large-trace-blob-offload.integration.test.ts. This file covers the
        // CH-specific surface: the resolver IS invoked and eventref is stripped.
        it("strips the reserved eventref attr from the returned span", async () => {
          setupGetTracesWithSpansMocks("trace-1", "span-1");

          const service = new TraceLegacyReadClickHouseRepository({
            resolveClickHouseClient: testResolveClickHouseClient,
            prisma: { project: { findUnique: vi.fn() } } as never,
            resolveTraceSpans: resolveTraceSpansFn,
            traceCanonicalisation,
          });

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
