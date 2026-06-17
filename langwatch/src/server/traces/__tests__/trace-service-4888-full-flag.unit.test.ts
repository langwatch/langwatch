/**
 * TDD tests for issue #4888 — TraceService full-flag read path, exercised at
 * the REAL seam.
 *
 * Resolution lives in the ClickHouse layer (`resolveAndMerge` →
 * `resolveOffloadedTraces`), gated per-call by a `resolveBlobs` flag that
 * `TraceService.getById` / `getTracesWithSpans` forward from `opts.full`.
 * Resolution operates on NormalizedSpan with FLAT `spanAttributes` carrying the
 * `langwatch.reserved.eventref.*` keys — the only level where the eventref is
 * present (the legacy mapper strips it and nests the rest under `params`).
 *
 * So these tests mock ONLY the raw ClickHouse client (summary + span rows) and
 * let the REAL CH service + REAL resolver run, with a fake BlobStore providing
 * `getFromEventLog`. That exercises the gate at the layer it actually lives —
 * unlike a TS-layer mock, which would pass on a shape production never produces.
 *
 * ACs covered:
 *   AC1 — full=true triggers resolution (getFromEventLog called ≥ 1 time) and
 *          the resolved span attribute is the full 400 KB value.
 *   AC2 — full=false (or omitted) → getFromEventLog called 0 times (preview).
 *   AC7 — cross-tenant: same EventId, wrong tenant → BlobNotFoundError → preview
 *          returned; getFromEventLog called with the reading tenant's id.
 *
 * BDD structure: describe(given/when) → it() — one expectation per test.
 * No "should" in test names.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Protections } from "~/server/elasticsearch/protections";
import type { BlobStore } from "~/server/app-layer/traces/blob-store.service";
import { BlobNotFoundError } from "~/server/app-layer/traces/blob-store.service";
import { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import { EVENTREF_ATTR_PREFIX } from "~/server/app-layer/traces/lean-for-projection";
import { TraceService } from "../trace.service";

// ---------------------------------------------------------------------------
// Hoisted mocks — mock only the raw CH SQL boundary so the real resolver runs
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

vi.mock("~/server/evaluations/evaluation.service", () => ({
  EvaluationService: Object.assign(vi.fn(), {
    create: () => ({}),
  }),
}));

vi.mock("../elasticsearch-trace.service", () => ({
  ElasticsearchTraceService: Object.assign(vi.fn(), {
    create: () => ({}),
  }),
}));

// Mirror the sibling test's tracer passthrough — the span exposes BOTH
// setAttribute (singular) and setAttributes (plural), matching the real OTel
// Span interface (TraceIOExtractionService calls setAttributes).
vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: (_name: string, ...args: unknown[]) => {
      const fn = args.length === 1 ? args[0] : args[1];
      const fakeSpan = {
        setAttribute: () => {},
        setAttributes: () => {},
      };
      return (fn as (s: typeof fakeSpan) => Promise<unknown>)(fakeSpan);
    },
  }),
}));

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IO_PREVIEW_BYTES = 65536;

const protections: Protections = {
  canSeeCosts: true,
  canSeePiiData: true,
  canSeeTopics: true,
  // Required for trace.input/output to survive applyTraceProtections — without
  // these the redaction layer strips trace.output to undefined.
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
} as Protections;

const PROJECT_ID_A = "tenant-aaa";
const PROJECT_ID_B = "tenant-bbb";
const TRACE_ID = "trace-001";

const FULL_OUTPUT = "x".repeat(400_000);
const PREVIEW_OUTPUT = "x".repeat(IO_PREVIEW_BYTES) + "…";

// ---------------------------------------------------------------------------
// Raw ClickHouse row fixtures (mirrors clickhouse-trace.service-resolution test)
// ---------------------------------------------------------------------------

/** Minimal trace-summary row as returned by ClickHouse. */
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

/**
 * Minimal span row carrying an offloaded eventref for langwatch.output:
 * a 64 KB preview value plus a flat reserved eventref pointer (the REAL
 * production shape — flat key on SpanAttributes).
 */
function makeSpanRowWithEventRef(traceId: string, spanId: string) {
  return {
    SpanId: spanId,
    TraceId: traceId,
    TenantId: PROJECT_ID_A,
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

/** Set up the two CH queries fetchTracesWithSpansJoined fires (summary, spans). */
function setupGetTracesWithSpansMocks() {
  mockClickHouseQuery
    .mockResolvedValueOnce({
      json: () => Promise.resolve([makeSummaryRow(TRACE_ID)]),
    })
    .mockResolvedValueOnce({
      json: () => Promise.resolve([makeSpanRowWithEventRef(TRACE_ID, "span-1")]),
    });
}

// ---------------------------------------------------------------------------
// Tenant-scoped BlobStore fake
// ---------------------------------------------------------------------------

/**
 * getFromEventLog resolves the full value only for PROJECT_ID_A; any other
 * tenant gets a BlobNotFoundError, mirroring the real TenantId WHERE predicate.
 */
function makeTenantScopedBlobStore(): BlobStore & {
  getFromEventLog: ReturnType<typeof vi.fn>;
} {
  const getFromEventLog = vi.fn(
    async ({ tenantId, field }: { tenantId: string; field: string }) => {
      if (tenantId === PROJECT_ID_A && field === "langwatch.output") {
        return FULL_OUTPUT;
      }
      throw new BlobNotFoundError("evt-001", field, tenantId);
    },
  );

  return {
    getFromEventLog,
    putSpool: vi.fn(),
    getSpool: vi.fn(),
    deleteSpool: vi.fn(),
  } as unknown as BlobStore & { getFromEventLog: ReturnType<typeof vi.fn> };
}

function makeService(blobStore: BlobStore): TraceService {
  return new TraceService(
    {} as never,
    { blobStore, ioExtractionService: new TraceIOExtractionService() },
  );
}

// ---------------------------------------------------------------------------
// AC1 — full=true triggers resolution at the CH layer
// ---------------------------------------------------------------------------

describe("TraceService — AC1: getById with full=true resolves from event_log", () => {
  let blobStore: ReturnType<typeof makeTenantScopedBlobStore>;
  let service: TraceService;

  beforeEach(() => {
    vi.clearAllMocks();
    blobStore = makeTenantScopedBlobStore();
    service = makeService(blobStore);
  });

  describe("given a trace whose span carries an offloaded langwatch.output eventref", () => {
    describe("when getById is called with opts { full: true }", () => {
      it("calls BlobStore.getFromEventLog at least once (resolution runs)", async () => {
        setupGetTracesWithSpansMocks();

        await service.getById(PROJECT_ID_A, TRACE_ID, protections, {
          full: true,
        });

        expect(blobStore.getFromEventLog).toHaveBeenCalledTimes(1);
      });

      it("the resolved span attribute byte length equals the full 400 KB value", async () => {
        setupGetTracesWithSpansMocks();

        const trace = await service.getById(
          PROJECT_ID_A,
          TRACE_ID,
          protections,
          { full: true },
        );

        const span = trace?.spans?.[0] as
          | { params?: { langwatch?: { output?: string } } }
          | undefined;
        const resolved = span?.params?.langwatch?.output;
        expect(
          resolved !== undefined &&
            Buffer.byteLength(resolved, "utf8") === 400_000,
        ).toBe(true);
      });

      it("no langwatch.reserved.* key survives in the returned span", async () => {
        setupGetTracesWithSpansMocks();

        const trace = await service.getById(
          PROJECT_ID_A,
          TRACE_ID,
          protections,
          { full: true },
        );

        const spanStr = JSON.stringify(trace?.spans?.[0] ?? {});
        expect(spanStr).not.toContain(EVENTREF_ATTR_PREFIX);
      });

      it("the recomputed trace.output value equals the full 400 KB value", async () => {
        setupGetTracesWithSpansMocks();

        const trace = await service.getById(
          PROJECT_ID_A,
          TRACE_ID,
          protections,
          { full: true },
        );

        expect(trace?.output?.value).toBe(FULL_OUTPUT);
      });
    });
  });
});

describe("TraceService — AC1: getTracesWithSpans with full=true resolves from event_log", () => {
  let blobStore: ReturnType<typeof makeTenantScopedBlobStore>;
  let service: TraceService;

  beforeEach(() => {
    vi.clearAllMocks();
    blobStore = makeTenantScopedBlobStore();
    service = makeService(blobStore);
  });

  describe("given a trace list with an offloaded langwatch.output eventref", () => {
    describe("when getTracesWithSpans is called with opts { full: true }", () => {
      it("calls BlobStore.getFromEventLog at least once", async () => {
        setupGetTracesWithSpansMocks();

        await service.getTracesWithSpans(PROJECT_ID_A, [TRACE_ID], protections, {
          full: true,
        });

        expect(blobStore.getFromEventLog).toHaveBeenCalledTimes(1);
      });

      it("the recomputed trace.output value equals the full 400 KB value", async () => {
        setupGetTracesWithSpansMocks();

        const traces = await service.getTracesWithSpans(
          PROJECT_ID_A,
          [TRACE_ID],
          protections,
          { full: true },
        );

        expect(traces[0]?.output?.value).toBe(FULL_OUTPUT);
      });
    });
  });
});

// ---------------------------------------------------------------------------
// AC2 — full=false (or omitted) → getFromEventLog called 0 times (preview)
// ---------------------------------------------------------------------------

describe("TraceService — AC2: getById without full resolves nothing (preview)", () => {
  let blobStore: ReturnType<typeof makeTenantScopedBlobStore>;
  let service: TraceService;

  beforeEach(() => {
    vi.clearAllMocks();
    blobStore = makeTenantScopedBlobStore();
    service = makeService(blobStore);
  });

  describe("when getById is called with opts { full: false }", () => {
    it("BlobStore.getFromEventLog is called 0 times", async () => {
      setupGetTracesWithSpansMocks();

      await service.getById(PROJECT_ID_A, TRACE_ID, protections, {
        full: false,
      });

      expect(blobStore.getFromEventLog).toHaveBeenCalledTimes(0);
    });
  });

  describe("when getById is called without opts (default)", () => {
    it("BlobStore.getFromEventLog is called 0 times", async () => {
      setupGetTracesWithSpansMocks();

      await service.getById(PROJECT_ID_A, TRACE_ID, protections);

      expect(blobStore.getFromEventLog).toHaveBeenCalledTimes(0);
    });

    it("the returned trace.output is the ≤64 KB preview, not the full value", async () => {
      setupGetTracesWithSpansMocks();

      const trace = await service.getById(PROJECT_ID_A, TRACE_ID, protections);

      expect(trace?.output?.value).not.toBe(FULL_OUTPUT);
    });
  });
});

describe("TraceService — AC2: getTracesWithSpans without full resolves nothing", () => {
  let blobStore: ReturnType<typeof makeTenantScopedBlobStore>;
  let service: TraceService;

  beforeEach(() => {
    vi.clearAllMocks();
    blobStore = makeTenantScopedBlobStore();
    service = makeService(blobStore);
  });

  describe("when getTracesWithSpans is called without opts (default)", () => {
    it("BlobStore.getFromEventLog is called 0 times", async () => {
      setupGetTracesWithSpansMocks();

      await service.getTracesWithSpans(PROJECT_ID_A, [TRACE_ID], protections);

      expect(blobStore.getFromEventLog).toHaveBeenCalledTimes(0);
    });
  });

  describe("when getTracesWithSpans is called with opts { full: false }", () => {
    it("BlobStore.getFromEventLog is called 0 times", async () => {
      setupGetTracesWithSpansMocks();

      await service.getTracesWithSpans(PROJECT_ID_A, [TRACE_ID], protections, {
        full: false,
      });

      expect(blobStore.getFromEventLog).toHaveBeenCalledTimes(0);
    });
  });
});

describe("TraceService — AC2: a service constructed without blobResolutionDeps never resolves", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given a TraceService created without blobResolutionDeps (list/search router context)", () => {
    describe("when getTracesWithSpans is called with full=true", () => {
      it("does not throw and returns the preview (no resolver wired)", async () => {
        setupGetTracesWithSpansMocks();
        const listService = new TraceService({} as never);

        const traces = await listService.getTracesWithSpans(
          PROJECT_ID_A,
          [TRACE_ID],
          protections,
          { full: true },
        );

        // No resolver → preview kept, no full value.
        expect(traces[0]?.output?.value).not.toBe(FULL_OUTPUT);
      });
    });
  });
});

// ---------------------------------------------------------------------------
// AC7 — cross-tenant: tenant B cannot read tenant A's event_log data
// ---------------------------------------------------------------------------

describe("TraceService — AC7: cross-tenant event_log read denied, preview returned", () => {
  let blobStore: ReturnType<typeof makeTenantScopedBlobStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    blobStore = makeTenantScopedBlobStore();
  });

  describe("given an eventref whose event_log row belongs to tenant A", () => {
    describe("when getById is called with full=true but projectId is tenant B", () => {
      it("getFromEventLog is called with tenantId = tenant B (not A)", async () => {
        setupGetTracesWithSpansMocks();
        const serviceB = makeService(blobStore);

        await serviceB.getById(PROJECT_ID_B, TRACE_ID, protections, {
          full: true,
        });

        const callArgs = blobStore.getFromEventLog.mock.calls[0]?.[0] as
          | { tenantId: string }
          | undefined;
        expect(callArgs?.tenantId).toBe(PROJECT_ID_B);
      });

      it("the returned trace output is the preview (not tenant A full value)", async () => {
        setupGetTracesWithSpansMocks();
        const serviceB = makeService(blobStore);

        const trace = await serviceB.getById(
          PROJECT_ID_B,
          TRACE_ID,
          protections,
          { full: true },
        );

        expect(trace?.output?.value).not.toBe(FULL_OUTPUT);
      });

      it("does not throw — cross-tenant denial degrades to preview", async () => {
        setupGetTracesWithSpansMocks();
        const serviceB = makeService(blobStore);

        await expect(
          serviceB.getById(PROJECT_ID_B, TRACE_ID, protections, { full: true }),
        ).resolves.not.toThrow();
      });
    });
  });
});
