/**
 * Integration test for issue #4888 — opt-in full blob resolution CROSSING THE
 * MAPPER boundary.
 *
 * The sibling unit tests stop short of the legacy-span mapper: the CH-resolution
 * unit test (clickhouse-trace.service-resolution.unit.test.ts) explicitly notes
 * that asserting the full restored value requires the SQL → row →
 * TraceSummaryData → `mapNormalizedSpanToSpan` pipeline. This test exercises
 * exactly that pipeline end-to-end:
 *
 *   ClickHouseTraceService.getTracesWithSpans({ resolveBlobs })
 *     → fetchTracesWithSpansJoined (real row → NormalizedSpan mapping)
 *     → resolveAndMerge → resolveOffloadedTraces (fake getFromEventLog)
 *     → mapNormalizedSpansToSpans (real legacy mapper: spanAttributes → params)
 *
 * Only the raw ClickHouse client and BlobStore.getFromEventLog are faked.
 *
 * AC1 (resolveBlobs:true): the >64 KB offloaded value is byte-identical after
 *   resolution AND survives the mapper (lands in `params.langwatch.output`,
 *   no `langwatch.reserved.*` key leaks), and trace.output widens past 64 KB.
 * AC2 (resolveBlobs:false — the list/enrich path): zero getFromEventLog calls,
 *   the ≤64 KB preview is preserved.
 *
 * BDD structure: describe(given/when) → it(). No "should" in names.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Protections } from "~/server/elasticsearch/protections";
import { EVENTREF_ATTR_PREFIX } from "~/server/app-layer/traces/lean-for-projection";
import type { BlobStore } from "~/server/app-layer/traces/blob-store.service";
import { BlobNotFoundError } from "~/server/app-layer/traces/blob-store.service";
import { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import { resolveOffloadedTraces } from "../resolve-offloaded-traces";
import { createLogger } from "~/utils/logger/server";

// ---------------------------------------------------------------------------
// Mock only the raw CH SQL boundary so the real mapper + resolver run.
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
      const fakeSpan = {
        setAttribute: () => {},
        setAttributes: () => {},
        addEvent: () => {},
      };
      return (fn as (s: typeof fakeSpan) => Promise<unknown>)(fakeSpan);
    },
  }),
}));

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IO_PREVIEW_BYTES = 65536;
const LARGE_BYTE_COUNT = 400_000;
const PROJECT_ID = "proj-4888";
const TRACE_ID = "trace-4888";

const FULL_OUTPUT = "x".repeat(LARGE_BYTE_COUNT);
const PREVIEW_OUTPUT = "x".repeat(IO_PREVIEW_BYTES) + "…";

const protections: Protections = {
  canSeeCosts: true,
  canSeePiiData: true,
  canSeeTopics: true,
  // Required for trace.input/output to survive applyTraceProtections.
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
} as Protections;

// ---------------------------------------------------------------------------
// Raw ClickHouse row fixtures
// ---------------------------------------------------------------------------

function makeSummaryRow(traceId: string) {
  return {
    ts_TraceId: traceId,
    ts_SpanCount: 1,
    ts_TotalDurationMs: 100,
    ts_ComputedIOSchemaVersion: "1",
    ts_ComputedInput: null,
    ts_ComputedOutput: `{"type":"text","value":${JSON.stringify(PREVIEW_OUTPUT)}}`,
    ts_TimeToFirstTokenMs: 10,
    ts_TimeToLastTokenMs: 90,
    ts_TokensPerSecond: 5,
    ts_ContainsErrorStatus: false,
    ts_ContainsOKStatus: true,
    ts_ErrorMessage: "",
    ts_Models: [],
    ts_TotalCost: 0.0,
    ts_NonBilledCost: 0.0,
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

function makeSpanRowWithEventRef(traceId: string, spanId: string) {
  return {
    SpanId: spanId,
    TraceId: traceId,
    TenantId: PROJECT_ID,
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
      "langwatch.output": PREVIEW_OUTPUT,
      [`${EVENTREF_ATTR_PREFIX}langwatch.output`]: JSON.stringify({
        field: "langwatch.output",
        eventId: "evt-001",
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

/** Sets up the two queries fetchTracesWithSpansJoined fires (summary, spans). */
function setupJoinedFetch() {
  mockClickHouseQuery
    .mockResolvedValueOnce({
      json: () => Promise.resolve([makeSummaryRow(TRACE_ID)]),
    })
    .mockResolvedValueOnce({
      json: () => Promise.resolve([makeSpanRowWithEventRef(TRACE_ID, "span-1")]),
    });
}

function makeEventRefBlobStore(contents: Record<string, string>): {
  blobStore: BlobStore;
  getFromEventLogSpy: ReturnType<typeof vi.fn>;
} {
  const getFromEventLogSpy = vi.fn(
    async ({ field }: { field: string }) => {
      if (field in contents) return contents[field]!;
      throw new BlobNotFoundError("evt-001", field, PROJECT_ID);
    },
  );
  const blobStore = {
    getFromEventLog: getFromEventLogSpy,
    putSpool: vi.fn(),
    getSpool: vi.fn(),
    deleteSpool: vi.fn(),
  } as unknown as BlobStore;
  return { blobStore, getFromEventLogSpy };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ClickHouseTraceService — #4888 full resolution crosses the mapper", () => {
  let ClickHouseTraceService: typeof import("../clickhouse-trace.service").ClickHouseTraceService;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../clickhouse-trace.service");
    ClickHouseTraceService = mod.ClickHouseTraceService;
  });

  function buildService(blobStore: BlobStore) {
    const resolveTraceSpansFn: import("../clickhouse-trace.service").ResolveTraceSpansFn =
      (projectId, normalizedSpans) =>
        resolveOffloadedTraces({
          projectId,
          normalizedSpans,
          blobStore,
          ioExtractionService: new TraceIOExtractionService(),
          logger: createLogger("test"),
        });
    return new ClickHouseTraceService(
      { project: { findUnique: vi.fn() } } as never,
      resolveTraceSpansFn,
    );
  }

  describe("given a >64 KB offloaded langwatch.output (preview + flat eventref)", () => {
    describe("when getTracesWithSpans is called with resolveBlobs: true (detail path)", () => {
      it("calls getFromEventLog exactly once", async () => {
        setupJoinedFetch();
        const { blobStore, getFromEventLogSpy } = makeEventRefBlobStore({
          "langwatch.output": FULL_OUTPUT,
        });
        const service = buildService(blobStore);

        await service.getTracesWithSpans(PROJECT_ID, [TRACE_ID], protections, {
          resolveBlobs: true,
        });

        expect(getFromEventLogSpy).toHaveBeenCalledOnce();
      });

      it("the resolved value survives the mapper into params.langwatch.output, byte-identical (400 KB)", async () => {
        setupJoinedFetch();
        const { blobStore } = makeEventRefBlobStore({
          "langwatch.output": FULL_OUTPUT,
        });
        const service = buildService(blobStore);

        const traces = await service.getTracesWithSpans(
          PROJECT_ID,
          [TRACE_ID],
          protections,
          { resolveBlobs: true },
        );

        const span = traces![0]!.spans[0] as unknown as {
          params?: { langwatch?: { output?: string } };
        };
        const resolved = span.params?.langwatch?.output;
        expect(resolved).toBe(FULL_OUTPUT);
        expect(Buffer.byteLength(resolved ?? "", "utf8")).toBe(LARGE_BYTE_COUNT);
      });

      it("no langwatch.reserved.* key leaks into the mapped span", async () => {
        setupJoinedFetch();
        const { blobStore } = makeEventRefBlobStore({
          "langwatch.output": FULL_OUTPUT,
        });
        const service = buildService(blobStore);

        const traces = await service.getTracesWithSpans(
          PROJECT_ID,
          [TRACE_ID],
          protections,
          { resolveBlobs: true },
        );

        const spanStr = JSON.stringify(traces![0]!.spans[0]);
        expect(spanStr).not.toContain(EVENTREF_ATTR_PREFIX);
      });

      it("trace.output widens past the 64 KB preview to the full value", async () => {
        setupJoinedFetch();
        const { blobStore } = makeEventRefBlobStore({
          "langwatch.output": FULL_OUTPUT,
        });
        const service = buildService(blobStore);

        const traces = await service.getTracesWithSpans(
          PROJECT_ID,
          [TRACE_ID],
          protections,
          { resolveBlobs: true },
        );

        const outputVal = traces![0]!.output?.value as string | undefined;
        expect(Buffer.byteLength(outputVal ?? "", "utf8")).toBeGreaterThan(
          IO_PREVIEW_BYTES,
        );
        expect(outputVal).toBe(FULL_OUTPUT);
      });
    });

    describe("when getTracesWithSpans is called with resolveBlobs: false (list/enrich path)", () => {
      it("issues ZERO getFromEventLog calls (no event_log load on the list path)", async () => {
        setupJoinedFetch();
        const { blobStore, getFromEventLogSpy } = makeEventRefBlobStore({
          "langwatch.output": FULL_OUTPUT,
        });
        const service = buildService(blobStore);

        await service.getTracesWithSpans(PROJECT_ID, [TRACE_ID], protections, {
          resolveBlobs: false,
        });

        expect(getFromEventLogSpy).not.toHaveBeenCalled();
      });

      it("preserves the ≤64 KB preview (does not widen to the full value)", async () => {
        setupJoinedFetch();
        const { blobStore } = makeEventRefBlobStore({
          "langwatch.output": FULL_OUTPUT,
        });
        const service = buildService(blobStore);

        const traces = await service.getTracesWithSpans(
          PROJECT_ID,
          [TRACE_ID],
          protections,
          { resolveBlobs: false },
        );

        const outputVal = traces![0]!.output?.value as string | undefined;
        expect(outputVal).not.toBe(FULL_OUTPUT);
      });
    });
  });
});
