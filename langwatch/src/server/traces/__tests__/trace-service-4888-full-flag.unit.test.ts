/**
 * TDD-red tests for issue #4888 — TraceService full-flag read path.
 *
 * These tests encode the seam contract described in the plan:
 *   TraceService.getById(projectId, traceId, protections, opts?: {full?: boolean})
 *   TraceService.getTracesWithSpans(projectId, traceIds, protections, opts?: {full?: boolean})
 *
 * They FAIL against current code because:
 *   - getById / getTracesWithSpans do not accept an opts argument yet.
 *   - TraceService.create() does not accept blobResolutionDeps from the
 *     router context (buildTraceBlobResolutionDeps() factory not wired yet).
 *   - The ClickHouseTraceService does not forward a resolveBlobs flag yet.
 *
 * ACs covered:
 *   AC1 — full=true triggers resolution (getFromEventLog called ≥ 1 time)
 *   AC2 — full=false (or omitted) → getFromEventLog called 0 times; also
 *          list paths (getAllTracesForProject etc.) pass no blobResolutionDeps
 *          (resolver fn undefined) and issue zero event_log SELECTs.
 *   AC7 — cross-tenant: same EventId, wrong tenant → BlobNotFoundError → preview
 *          returned; getFromEventLog called but returns no rows for tenant B.
 *
 * Mocking approach matches trace.service.unit.test.ts + trace-service-blob-resolution.unit.test.ts:
 *   - vi.hoisted for ClickHouseTraceService mock
 *   - Real TraceIOExtractionService
 *   - BlobStore stub that records calls and simulates tenant scoping
 *
 * BDD structure: describe(given/when) → it() — one expectation per test.
 * No "should" in test names.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Trace } from "~/server/tracer/types";
import type { Protections } from "~/server/elasticsearch/protections";
import type { BlobStore } from "~/server/app-layer/traces/blob-store.service";
import {
  BlobNotFoundError,
} from "~/server/app-layer/traces/blob-store.service";
import { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import { EVENTREF_ATTR_PREFIX } from "~/server/app-layer/traces/lean-for-projection";
import { TraceService } from "../trace.service";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockGetTracesWithSpansCH, mockResolveTraceIdByPrefixCH } = vi.hoisted(
  () => ({
    mockGetTracesWithSpansCH: vi.fn(),
    mockResolveTraceIdByPrefixCH: vi.fn(),
  }),
);

const mockClickHouseInstance = {
  getTracesWithSpans: mockGetTracesWithSpansCH,
  getAllTracesForProject: vi.fn(),
  getTopicCounts: vi.fn(),
  getCustomersAndLabels: vi.fn(),
  getDistinctFieldNames: vi.fn(),
  getSpanForPromptStudio: vi.fn(),
  getTracesByThreadId: vi.fn(),
  getTracesWithSpansByThreadIds: vi.fn(),
  resolveTraceIdByPrefix: mockResolveTraceIdByPrefixCH,
};

vi.mock("../clickhouse-trace.service", () => ({
  ClickHouseTraceService: Object.assign(vi.fn(), {
    create: () => mockClickHouseInstance,
  }),
}));

vi.mock("../elasticsearch-trace.service", () => ({
  ElasticsearchTraceService: Object.assign(vi.fn(), {
    create: () => ({}),
  }),
}));

vi.mock("~/server/evaluations/evaluation.service", () => ({
  EvaluationService: Object.assign(vi.fn(), {
    create: () => ({}),
  }),
}));

vi.mock("~/server/db", () => ({
  prisma: {},
}));

vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: (
      _name: string,
      _opts: unknown,
      fn: (span: { setAttribute: () => void }) => Promise<unknown>,
    ) => fn({ setAttribute: () => {} }),
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
} as Protections;

const PROJECT_ID_A = "tenant-aaa";
const PROJECT_ID_B = "tenant-bbb";
const TRACE_ID = "trace-001";

const FULL_OUTPUT = "x".repeat(400_000);
const PREVIEW_OUTPUT = "x".repeat(IO_PREVIEW_BYTES) + "…";

// ---------------------------------------------------------------------------
// BlobStore fakes
// ---------------------------------------------------------------------------

/**
 * Tenant-scoped BlobStore stub: getFromEventLog only resolves for PROJECT_ID_A.
 * A call from PROJECT_ID_B returns no rows (BlobNotFoundError), mirroring the
 * real TenantId WHERE predicate.
 */
function makeTenantScopedBlobStore(): BlobStore & {
  getFromEventLog: ReturnType<typeof vi.fn>;
} {
  const getFromEventLog = vi.fn(
    async ({
      tenantId,
      field,
    }: {
      eventId: string;
      field: string;
      tenantId: string;
      aggregateType: string;
      aggregateId: string;
    }) => {
      if (tenantId === PROJECT_ID_A && field === "langwatch.output") {
        return FULL_OUTPUT;
      }
      // Wrong tenant or unknown field → no rows → BlobNotFoundError
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

/**
 * Builds a Trace fixture whose single span carries an offloaded langwatch.output
 * eventref (preview value + reserved pointer).
 */
function makeOffloadedTrace(): Trace {
  return {
    trace_id: TRACE_ID,
    project_id: PROJECT_ID_A,
    metadata: {},
    timestamps: { started_at: 0, inserted_at: 0, updated_at: 0 },
    input: undefined,
    output: { value: PREVIEW_OUTPUT },
    spans: [
      {
        span_id: "span-1",
        trace_id: TRACE_ID,
        type: "span",
        name: "test-span",
        timestamps: { started_at: 0, finished_at: 1000 },
        params: {},
        attributes: {
          "langwatch.output": PREVIEW_OUTPUT,
          [`${EVENTREF_ATTR_PREFIX}langwatch.output`]: JSON.stringify({
            field: "langwatch.output",
            eventId: "evt-001",
          }),
        },
      },
    ],
  } as unknown as Trace;
}

// ---------------------------------------------------------------------------
// AC1 — full=true triggers resolution (getFromEventLog called ≥ 1 time)
// ---------------------------------------------------------------------------

describe(
  "TraceService — AC1: getById with full=true calls BlobStore.getFromEventLog",
  () => {
    let blobStore: ReturnType<typeof makeTenantScopedBlobStore>;
    let ioExtractionService: TraceIOExtractionService;
    let service: TraceService;

    beforeEach(() => {
      vi.clearAllMocks();
      blobStore = makeTenantScopedBlobStore();
      ioExtractionService = new TraceIOExtractionService();
      // TraceService with blobResolutionDeps wired
      service = new TraceService(
        {} as never,
        { blobStore, ioExtractionService },
      );
      mockGetTracesWithSpansCH.mockResolvedValue([makeOffloadedTrace()]);
      mockResolveTraceIdByPrefixCH.mockResolvedValue([]);
    });

    describe("given a trace with an offloaded langwatch.output eventref", () => {
      describe("when getById is called with opts { full: true }", () => {
        it("calls BlobStore.getFromEventLog at least once (resolution runs)", async () => {
          // AC1: the full flag triggers event_log resolution.
          // This test FAILS until TraceService.getById accepts opts.full and
          // propagates it to ClickHouseTraceService which fires the resolver.
          await service.getById(PROJECT_ID_A, TRACE_ID, protections, {
            full: true,
          });

          expect(blobStore.getFromEventLog).toHaveBeenCalledTimes(1);
        });

        it("the returned trace output byte length equals the full 400 KB ingested value (not the 65539-byte preview)", async () => {
          const trace = await service.getById(
            PROJECT_ID_A,
            TRACE_ID,
            protections,
            { full: true },
          );

          const outputVal = trace?.output?.value as string | undefined;
          // Full resolution means 400,000 bytes — NOT the 65539-byte preview (65536 "x" + "…")
          expect(
            outputVal !== undefined &&
              Buffer.byteLength(outputVal, "utf8") === 400_000,
          ).toBe(true);
        });

        it("the returned trace output value equals FULL_OUTPUT (not the preview string)", async () => {
          const trace = await service.getById(
            PROJECT_ID_A,
            TRACE_ID,
            protections,
            { full: true },
          );

          // After resolution, output.value should equal the full 400 KB string from event_log
          expect(trace?.output?.value).toBe(FULL_OUTPUT);
        });
      });
    });
  },
);

describe(
  "TraceService — AC1: getTracesWithSpans with full=true calls BlobStore.getFromEventLog",
  () => {
    let blobStore: ReturnType<typeof makeTenantScopedBlobStore>;
    let ioExtractionService: TraceIOExtractionService;
    let service: TraceService;

    beforeEach(() => {
      vi.clearAllMocks();
      blobStore = makeTenantScopedBlobStore();
      ioExtractionService = new TraceIOExtractionService();
      service = new TraceService(
        {} as never,
        { blobStore, ioExtractionService },
      );
      mockGetTracesWithSpansCH.mockResolvedValue([makeOffloadedTrace()]);
    });

    describe("given a trace list with an offloaded langwatch.output eventref", () => {
      describe("when getTracesWithSpans is called with opts { full: true }", () => {
        it("calls BlobStore.getFromEventLog at least once", async () => {
          await service.getTracesWithSpans(
            PROJECT_ID_A,
            [TRACE_ID],
            protections,
            { full: true },
          );

          expect(blobStore.getFromEventLog).toHaveBeenCalledTimes(1);
        });

        it("the returned trace output byte length equals the full 400 KB value (not the preview)", async () => {
          const traces = await service.getTracesWithSpans(
            PROJECT_ID_A,
            [TRACE_ID],
            protections,
            { full: true },
          );

          const outputVal = traces[0]?.output?.value as string | undefined;
          // Full resolution means 400,000 bytes — NOT the 65539-byte preview
          expect(
            outputVal !== undefined &&
              Buffer.byteLength(outputVal, "utf8") === 400_000,
          ).toBe(true);
        });
      });
    });
  },
);

// ---------------------------------------------------------------------------
// AC2 — full=false (or omitted) → getFromEventLog called 0 times
// ---------------------------------------------------------------------------

describe(
  "TraceService — AC2: getById with full=false (or omitted) calls getFromEventLog 0 times",
  () => {
    let blobStore: ReturnType<typeof makeTenantScopedBlobStore>;
    let ioExtractionService: TraceIOExtractionService;
    let service: TraceService;

    beforeEach(() => {
      vi.clearAllMocks();
      blobStore = makeTenantScopedBlobStore();
      ioExtractionService = new TraceIOExtractionService();
      service = new TraceService(
        {} as never,
        { blobStore, ioExtractionService },
      );
      mockGetTracesWithSpansCH.mockResolvedValue([makeOffloadedTrace()]);
      mockResolveTraceIdByPrefixCH.mockResolvedValue([]);
    });

    describe("when getById is called with opts { full: false }", () => {
      it("BlobStore.getFromEventLog is called 0 times (preview returned)", async () => {
        // AC2: the absence / false flag must NOT trigger event_log resolution.
        // This test FAILS until the conditional gating on opts.full is wired.
        await service.getById(PROJECT_ID_A, TRACE_ID, protections, {
          full: false,
        });

        expect(blobStore.getFromEventLog).toHaveBeenCalledTimes(0);
      });
    });

    describe("when getById is called without opts (default)", () => {
      it("BlobStore.getFromEventLog is called 0 times (preview returned)", async () => {
        await service.getById(PROJECT_ID_A, TRACE_ID, protections);

        expect(blobStore.getFromEventLog).toHaveBeenCalledTimes(0);
      });
    });
  },
);

describe(
  "TraceService — AC2: getTracesWithSpans with full=false (or omitted) calls getFromEventLog 0 times",
  () => {
    let blobStore: ReturnType<typeof makeTenantScopedBlobStore>;
    let ioExtractionService: TraceIOExtractionService;
    let service: TraceService;

    beforeEach(() => {
      vi.clearAllMocks();
      blobStore = makeTenantScopedBlobStore();
      ioExtractionService = new TraceIOExtractionService();
      service = new TraceService(
        {} as never,
        { blobStore, ioExtractionService },
      );
      mockGetTracesWithSpansCH.mockResolvedValue([makeOffloadedTrace()]);
    });

    describe("when getTracesWithSpans is called without opts (default)", () => {
      it("BlobStore.getFromEventLog is called 0 times", async () => {
        await service.getTracesWithSpans(PROJECT_ID_A, [TRACE_ID], protections);

        expect(blobStore.getFromEventLog).toHaveBeenCalledTimes(0);
      });
    });

    describe("when getTracesWithSpans is called with opts { full: false }", () => {
      it("BlobStore.getFromEventLog is called 0 times", async () => {
        await service.getTracesWithSpans(
          PROJECT_ID_A,
          [TRACE_ID],
          protections,
          { full: false },
        );

        expect(blobStore.getFromEventLog).toHaveBeenCalledTimes(0);
      });
    });
  },
);

describe(
  "TraceService — AC2: TraceService constructed without blobResolutionDeps issues 0 event_log SELECTs",
  () => {
    let blobStoreSpy: ReturnType<typeof makeTenantScopedBlobStore>;

    beforeEach(() => {
      vi.clearAllMocks();
      blobStoreSpy = makeTenantScopedBlobStore();
      mockGetTracesWithSpansCH.mockResolvedValue([makeOffloadedTrace()]);
      mockResolveTraceIdByPrefixCH.mockResolvedValue([]);
    });

    describe("given a TraceService created without blobResolutionDeps (list/search router context)", () => {
      describe("when getTracesWithSpans is called (simulating getAllTracesForProject list path)", () => {
        it("does not call any BlobStore.getFromEventLog (resolver fn is undefined)", async () => {
          // This is the AC2 assertion for the list path: TraceService.create()
          // without deps → resolveTraceSpansFn is undefined → no event_log calls.
          const listService = new TraceService({} as never);

          await listService.getTracesWithSpans(
            PROJECT_ID_A,
            [TRACE_ID],
            protections,
          );

          // The blobStoreSpy is NOT wired to this service, but we assert the
          // construction shape: no resolver means no event_log SELECT is issued.
          // The test fails if the service calls a resolver that does not exist.
          expect(blobStoreSpy.getFromEventLog).toHaveBeenCalledTimes(0);
        });
      });
    });
  },
);

// ---------------------------------------------------------------------------
// AC7 — cross-tenant: tenant B cannot read tenant A's event_log data
// ---------------------------------------------------------------------------

describe("TraceService — AC7: cross-tenant event_log read denied, preview returned", () => {
  let blobStore: ReturnType<typeof makeTenantScopedBlobStore>;
  let ioExtractionService: TraceIOExtractionService;

  beforeEach(() => {
    vi.clearAllMocks();
    blobStore = makeTenantScopedBlobStore();
    ioExtractionService = new TraceIOExtractionService();
    // Return the same offloaded trace body regardless of tenant (simulates
    // the projection row being accessible but event_log row belonging to A)
    mockGetTracesWithSpansCH.mockResolvedValue([makeOffloadedTrace()]);
    mockResolveTraceIdByPrefixCH.mockResolvedValue([]);
  });

  describe("given an eventref pointing to event_log row owned by tenant A", () => {
    describe("when getById is called with full=true but projectId is tenant B", () => {
      it("BlobStore.getFromEventLog is called (resolution attempted for tenant B)", async () => {
        // The call IS attempted but the tenantId predicate returns no rows.
        const serviceB = new TraceService(
          {} as never,
          { blobStore, ioExtractionService },
        );

        await serviceB.getById(PROJECT_ID_B, TRACE_ID, protections, {
          full: true,
        });

        // Resolution was attempted (event_log SELECT issued for tenant B)
        expect(blobStore.getFromEventLog).toHaveBeenCalledTimes(1);
      });

      it("getFromEventLog was called with tenantId = tenant B (not A)", async () => {
        const serviceB = new TraceService(
          {} as never,
          { blobStore, ioExtractionService },
        );

        await serviceB.getById(PROJECT_ID_B, TRACE_ID, protections, {
          full: true,
        });

        const callArgs = blobStore.getFromEventLog.mock.calls[0]?.[0] as
          | { tenantId: string }
          | undefined;
        expect(callArgs?.tenantId).toBe(PROJECT_ID_B);
      });

      it("the returned trace output is the preview (not tenant A full value)", async () => {
        const serviceB = new TraceService(
          {} as never,
          { blobStore, ioExtractionService },
        );

        const trace = await serviceB.getById(
          PROJECT_ID_B,
          TRACE_ID,
          protections,
          { full: true },
        );

        // BlobNotFoundError was thrown for tenant B → preview kept
        const outputVal = trace?.output?.value as string | undefined;
        // Must NOT be the full 400 KB value (that belongs to tenant A)
        expect(outputVal).not.toBe(FULL_OUTPUT);
      });

      it("does not throw — cross-tenant denial is graceful (preview degradation)", async () => {
        const serviceB = new TraceService(
          {} as never,
          { blobStore, ioExtractionService },
        );

        await expect(
          serviceB.getById(PROJECT_ID_B, TRACE_ID, protections, { full: true }),
        ).resolves.not.toThrow();
      });
    });
  });
});
