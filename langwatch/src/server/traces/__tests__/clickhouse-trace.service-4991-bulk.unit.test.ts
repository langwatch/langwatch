/**
 * #4991 ("2 of 2" of #4888) — bulk read-path full-blob resolution at the
 * ClickHouse seam. Mocks only the raw CH SQL boundary + a fake BlobStore and
 * runs the REAL ClickHouseTraceService + REAL batch resolver + REAL mapper, so
 * the gate is exercised where it actually lives.
 *
 * ACs covered here:
 *   AC1 — download/export (getAllTracesForProject includeSpans + resolveBlobs)
 *         resolves the FULL value during span enrichment.
 *   AC2 — thread-detail (getTracesByThreadId resolveBlobs) resolves the FULL value.
 *   AC5 — the list/search grid (includeSpans WITHOUT resolveBlobs) issues ZERO
 *         event_log reads and keeps the ≤64 KB preview (heavy-read protection).
 *
 * BDD structure: given/when nested describes, action-based it() names.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BlobStore } from "~/server/app-layer/traces/blob-store.service";
import { BlobNotFoundError } from "~/server/app-layer/traces/blob-store.service";
import { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import type { NormalizedSpan } from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";
import type { Protections } from "~/server/traces/protections";
import { createLogger } from "~/utils/logger/server";
import { ClickHouseTraceService } from "../clickhouse-trace.service";
import type { ResolvedTraceSpans } from "../resolve-offloaded-traces";
import { resolveOffloadedTraces } from "../resolve-offloaded-traces";
import { resolveOffloadedTracesBatch } from "../resolve-offloaded-traces-batch";
import type { GetAllTracesForProjectInput } from "../types";
import {
  makeSpanRowWithEventRef,
  makeSummaryRow,
} from "./fixtures/ch-row-fixtures";

// ---------------------------------------------------------------------------
// Hoisted mock — only the raw CH SQL boundary
// ---------------------------------------------------------------------------

const { mockClickHouseQuery } = vi.hoisted(() => ({
  mockClickHouseQuery: vi.fn(),
}));

vi.mock("~/server/clickhouse/clickhouseClient", () => ({
  getClickHouseClientForProject: () =>
    Promise.resolve({ query: mockClickHouseQuery }),
}));

vi.mock("~/server/db", () => ({ prisma: {} }));

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
        setAttribute: () => undefined,
        setAttributes: () => undefined,
        addEvent: () => undefined,
      };
      return (fn as (s: typeof fakeSpan) => Promise<unknown>)(fakeSpan);
    },
  }),
}));

// ---------------------------------------------------------------------------
// Constants / helpers
// ---------------------------------------------------------------------------

const IO_PREVIEW_BYTES = 65536;
const LARGE_BYTE_COUNT = 400_000;
const FULL_OUTPUT = "x".repeat(LARGE_BYTE_COUNT);
const PREVIEW_OUTPUT = "x".repeat(IO_PREVIEW_BYTES) + "…";

const PROJECT_ID = "proj-4991";
const TRACE_ID = "trace-4991";

const protections: Protections = {
  canSeeCosts: true,
  canSeePiiData: true,
  canSeeTopics: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
} as Protections;

const baseInput: GetAllTracesForProjectInput = {
  projectId: PROJECT_ID,
  startDate: 0,
  endDate: Date.now(),
  filters: {},
} as GetAllTracesForProjectInput;

function makeEventRefBlobStore(): {
  blobStore: BlobStore;
  getFromEventLog: ReturnType<typeof vi.fn>;
} {
  const getFromEventLog = vi.fn(async ({ field }: { field: string }) => {
    if (field === "langwatch.output") return FULL_OUTPUT;
    throw new BlobNotFoundError("evt-001", field, PROJECT_ID);
  });
  return {
    blobStore: {
      getFromEventLog,
      putSpool: vi.fn(),
      getSpool: vi.fn(),
      deleteSpool: vi.fn(),
    } as unknown as BlobStore,
    getFromEventLog,
  };
}

/** ClickHouseTraceService wired with BOTH resolvers from a fake blobStore. */
function buildService(blobStore: BlobStore): ClickHouseTraceService {
  const ioExtractionService = new TraceIOExtractionService();
  const logger = createLogger("test");
  return new ClickHouseTraceService(
    { project: { findUnique: vi.fn() } } as never,
    (projectId, normalizedSpans) =>
      resolveOffloadedTraces({
        projectId,
        normalizedSpans,
        blobStore,
        ioExtractionService,
        logger,
      }),
    (projectId, spansPerTrace) =>
      resolveOffloadedTracesBatch({
        projectId,
        spansPerTrace,
        blobStore,
        ioExtractionService,
        logger,
      }),
  );
}

/** Mocks the getAllTracesForProject query sequence for an includeSpans read. */
function setupGetAllWithSpansMocks() {
  mockClickHouseQuery
    // fetchTracesWithPagination: count, IDs, data
    .mockResolvedValueOnce({ json: () => Promise.resolve([{ total: "1" }]) })
    .mockResolvedValueOnce({
      json: () => Promise.resolve([{ TraceId: TRACE_ID }]),
    })
    .mockResolvedValueOnce({
      json: () =>
        Promise.resolve([
          makeSummaryRow(TRACE_ID, {
            computedOutput: `{"type":"text","value":${JSON.stringify(PREVIEW_OUTPUT)}}`,
          }),
        ]),
    })
    // enrichTracesWithSpans -> fetchTracesWithSpansJoined: summary, spans
    .mockResolvedValueOnce({
      json: () =>
        Promise.resolve([
          makeSummaryRow(TRACE_ID, {
            computedOutput: `{"type":"text","value":${JSON.stringify(PREVIEW_OUTPUT)}}`,
          }),
        ]),
    })
    .mockResolvedValueOnce({
      json: () =>
        Promise.resolve([
          makeSpanRowWithEventRef(TRACE_ID, "span-1", {
            tenantId: PROJECT_ID,
            previewOutput: PREVIEW_OUTPUT,
          }),
        ]),
    })
    // fetchEvaluationRows
    .mockResolvedValueOnce({ json: () => Promise.resolve([]) });
}

/**
 * Mocks the getTracesByThreadId query sequence: DISTINCT TraceId, the hint-less
 * OccurredAt-range resolve, then the joined summary + spans reads.
 *
 * The thread path knows only trace ids, so it passes no `occurredAt` hint and
 * fetchTracesWithSpansJoined resolves the partition window itself first (#5231).
 * That is a real query and consumes a mock — omit it and every later mock shifts
 * by one, so the spans read silently gets the summary's rows.
 */
function setupThreadMocks() {
  mockClickHouseQuery
    // SELECT DISTINCT TraceId (JSONEachRow → result.json())
    .mockResolvedValueOnce({
      json: () => Promise.resolve([{ TraceId: TRACE_ID }]),
    })
    // resolveOccurredAtRange: min/max OccurredAt for partition pruning (#5231)
    .mockResolvedValueOnce({
      json: () =>
        Promise.resolve([
          { fromMs: 1_700_000_000_000, toMs: 1_700_000_100_000 },
        ]),
    })
    // fetchTracesWithSpansJoined: summary, spans
    .mockResolvedValueOnce({
      json: () =>
        Promise.resolve([
          makeSummaryRow(TRACE_ID, {
            computedOutput: `{"type":"text","value":${JSON.stringify(PREVIEW_OUTPUT)}}`,
          }),
        ]),
    })
    .mockResolvedValueOnce({
      json: () =>
        Promise.resolve([
          makeSpanRowWithEventRef(TRACE_ID, "span-1", {
            tenantId: PROJECT_ID,
            previewOutput: PREVIEW_OUTPUT,
          }),
        ]),
    });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// AC1 — download/export resolves full during enrichment
// ---------------------------------------------------------------------------

describe("ClickHouseTraceService.getAllTracesForProject — #4991 AC1 export", () => {
  describe("given a >64 KB offloaded trace and includeSpans + resolveBlobs", () => {
    describe("when the download path reads it", () => {
      it("reads the full value back from event_log (not the preview)", async () => {
        setupGetAllWithSpansMocks();
        const { blobStore, getFromEventLog } = makeEventRefBlobStore();
        const service = buildService(blobStore);

        const result = await service.getAllTracesForProject(
          baseInput,
          protections,
          { includeSpans: true, resolveBlobs: true },
        );

        const trace = result!.groups.flat()[0]!;
        expect(getFromEventLog).toHaveBeenCalled();
        expect(trace.output?.value).toBe(FULL_OUTPUT);
      });

      it("widens the exported output past the 64 KB preview", async () => {
        setupGetAllWithSpansMocks();
        const { blobStore } = makeEventRefBlobStore();
        const service = buildService(blobStore);

        const result = await service.getAllTracesForProject(
          baseInput,
          protections,
          { includeSpans: true, resolveBlobs: true },
        );

        const outputVal = result!.groups.flat()[0]!.output?.value as string;
        expect(Buffer.byteLength(outputVal, "utf8")).toBeGreaterThan(
          IO_PREVIEW_BYTES,
        );
      });
    });
  });
});

// ---------------------------------------------------------------------------
// Batch-resolver contract — one resolution per input trace, IN INPUT ORDER
//
// ResolveTraceSpansBatchFn is INJECTED and ResolvedTraceSpans carries no trace
// identity, so the pairing is purely positional and the type cannot enforce it.
// Two distinct ways to break it, and the ORDER one is the dangerous half: it
// keeps the count, so a length-only guard waves it through and each trace's IO
// is scattered onto its neighbour. Drive genuinely non-conforming resolvers
// through the REAL service and observe the failure, rather than asserting on a
// string.
// ---------------------------------------------------------------------------

describe("ClickHouseTraceService — batch-resolver contract", () => {
  /** Service wired with a batch resolver of the caller's choosing. */
  function buildServiceWithBatchResolver(
    resolve: (
      projectId: string,
      spansPerTrace: NormalizedSpan[][],
    ) => Promise<ResolvedTraceSpans[]>,
  ): ClickHouseTraceService {
    return new ClickHouseTraceService(
      { project: { findUnique: vi.fn() } } as never,
      undefined,
      resolve,
    );
  }

  /** Passthrough resolution for a trace's spans (resolves nothing). */
  function passthrough(spans: NormalizedSpan[]): ResolvedTraceSpans {
    return {
      resolvedSpans: spans,
      recomputedInput: null,
      recomputedOutput: null,
      anyResolved: false,
    };
  }

  describe("given a resolver that returns FEWER resolutions than input traces", () => {
    describe("when a resolveBlobs read runs", () => {
      it("throws naming the cardinality mismatch", async () => {
        setupThreadMocks();
        // Violates the contract: 0 resolutions for 1 input trace.
        const service = buildServiceWithBatchResolver(() =>
          Promise.resolve([]),
        );

        await expect(
          service.getTracesByThreadId(PROJECT_ID, "thread-1", protections, {
            resolveBlobs: true,
          }),
        ).rejects.toThrow(/returned 0 resolution\(s\) for 1 trace\(s\)/);
      });
    });
  });

  describe("given a resolver that returns the right COUNT in the WRONG ORDER", () => {
    const TRACE_A = "trace-a";
    const TRACE_B = "trace-b";

    /** Two traces, each with one span — mocked for a direct getTracesWithSpans read. */
    function setupTwoTraceMocks() {
      mockClickHouseQuery
        // fetchTracesWithSpansJoined: summary rows
        .mockResolvedValueOnce({
          json: () =>
            Promise.resolve([makeSummaryRow(TRACE_A), makeSummaryRow(TRACE_B)]),
        })
        // fetchTracesWithSpansJoined: span rows
        .mockResolvedValueOnce({
          json: () =>
            Promise.resolve([
              makeSpanRowWithEventRef(TRACE_A, "span-a", {
                tenantId: PROJECT_ID,
                previewOutput: PREVIEW_OUTPUT,
              }),
              makeSpanRowWithEventRef(TRACE_B, "span-b", {
                tenantId: PROJECT_ID,
                previewOutput: PREVIEW_OUTPUT,
              }),
            ]),
        });
    }

    describe("when a resolveBlobs read runs", () => {
      it("throws naming the misaligned trace, instead of scattering each trace's IO onto its neighbour", async () => {
        setupTwoTraceMocks();
        const service = buildServiceWithBatchResolver((_projectId, spans) =>
          // Right count (2 for 2), reversed order — the silent-corruption case
          // a length-only guard cannot see.
          Promise.resolve([...spans].reverse().map(passthrough)),
        );

        await expect(
          service.getTracesWithSpans(
            PROJECT_ID,
            [TRACE_A, TRACE_B],
            protections,
            { from: 0, to: Date.now() },
            { resolveBlobs: true },
          ),
        ).rejects.toThrow(/resolutions must come back in input order/);
      });

      // The identity check has a blind spot, and this is it. A trace can
      // legitimately have ZERO spans — the read builds its map from summary rows
      // and defaults spans to [] — and a span-less trace has no traceId on
      // EITHER side to compare. Swap it with a spans-ful trace and identity sees
      // nothing at either index, while the real trace silently loses its spans.
      // Only the span-count check catches this.
      it("catches a swap with a span-less trace, which has no identity on either side", async () => {
        // Two summary rows, but span rows for TRACE_A only — so TRACE_B enters
        // the resolver with an empty spans array, exactly as production would.
        mockClickHouseQuery
          .mockResolvedValueOnce({
            json: () =>
              Promise.resolve([
                makeSummaryRow(TRACE_A),
                makeSummaryRow(TRACE_B),
              ]),
          })
          .mockResolvedValueOnce({
            json: () =>
              Promise.resolve([
                makeSpanRowWithEventRef(TRACE_A, "span-a", {
                  tenantId: PROJECT_ID,
                  previewOutput: PREVIEW_OUTPUT,
                }),
              ]),
          });

        const service = buildServiceWithBatchResolver((_projectId, spans) =>
          // Right count (2 for 2), transposed: TRACE_A's index gets the span-less
          // resolution, TRACE_B's index gets TRACE_A's spans.
          Promise.resolve([
            passthrough(spans[1] ?? []),
            passthrough(spans[0] ?? []),
          ]),
        );

        await expect(
          service.getTracesWithSpans(
            PROJECT_ID,
            [TRACE_A, TRACE_B],
            protections,
            { from: 0, to: Date.now() },
            { resolveBlobs: true },
          ),
        ).rejects.toThrow(/resolutions must come back in input order/);
      });
    });
  });

  describe("given a CONFORMING resolver", () => {
    describe("when a resolveBlobs read runs", () => {
      it("passes the contract check and returns the traces", async () => {
        setupThreadMocks();
        const service = buildServiceWithBatchResolver((_projectId, spans) =>
          Promise.resolve(spans.map(passthrough)),
        );

        const traces = await service.getTracesByThreadId(
          PROJECT_ID,
          "thread-1",
          protections,
          { resolveBlobs: true },
        );

        expect(traces.map((t) => t.trace_id)).toEqual([TRACE_ID]);
      });
    });
  });
});

// ---------------------------------------------------------------------------
// getTracesByThreadId's chronological ordering is a CONTRACT, not an incident.
//
// The underlying bulk read returns trace-id order; this method re-sorts. The
// public-share branch of the tRPC thread route re-projects its authorized subset
// onto that order rather than re-deriving one — so if this sort were dropped, the
// anonymous (least-exercised) path would silently mis-order and the router's own
// tests, which mock this service, would not notice. Pin it here, at the seam that
// owns it.
// ---------------------------------------------------------------------------

describe("ClickHouseTraceService.getTracesByThreadId — ordering contract", () => {
  describe("given a thread whose traces come back from the bulk read out of order", () => {
    describe("when the thread is read", () => {
      it("returns traces sorted chronologically", async () => {
        const EARLY = "trace-early";
        const LATE = "trace-late";

        mockClickHouseQuery
          // SELECT DISTINCT TraceId
          .mockResolvedValueOnce({
            json: () =>
              Promise.resolve([{ TraceId: LATE }, { TraceId: EARLY }]),
          })
          // resolveOccurredAtRange (hint-less thread read)
          .mockResolvedValueOnce({
            json: () =>
              Promise.resolve([
                { fromMs: 1_700_000_000_000, toMs: 1_700_000_100_000 },
              ]),
          })
          // joined summary rows — deliberately LATE first, as a trace-id-ordered
          // read may well return them.
          .mockResolvedValueOnce({
            json: () =>
              Promise.resolve([
                makeSummaryRow(LATE, { occurredAt: 1_700_000_090_000 }),
                makeSummaryRow(EARLY, { occurredAt: 1_700_000_010_000 }),
              ]),
          })
          // joined span rows
          .mockResolvedValueOnce({ json: () => Promise.resolve([]) });

        const { blobStore } = makeEventRefBlobStore();
        const service = buildService(blobStore);

        const traces = await service.getTracesByThreadId(
          PROJECT_ID,
          "thread-1",
          protections,
        );

        expect(traces.map((t) => t.trace_id)).toEqual([EARLY, LATE]);
      });
    });
  });
});

// ---------------------------------------------------------------------------
// AC1 — a SUMMARY read (no spans emitted) still resolves trace-level IO
//
// The bug this guards: resolution lives inside enrichTracesWithSpans, which used
// to run only `if (options.includeSpans)`. A summary export / spans-less download
// sets includeSpans=false, so resolveBlobs was never even READ — the flag was
// inert and the truncated 64 KB preview shipped anyway. Setting resolveBlobs:true
// at the call sites (ExportService, getAllForDownload) fixed nothing on its own;
// a router-level test asserting the flag is FORWARDED cannot see that, because it
// passes whether or not the flag has any runtime effect. This test reads through
// the REAL service and asserts the VALUE.
// ---------------------------------------------------------------------------

describe("ClickHouseTraceService.getAllTracesForProject — #4991 AC1 summary read", () => {
  describe("given a >64 KB offloaded trace and resolveBlobs WITHOUT includeSpans", () => {
    describe("when a summary export / spans-less download reads it", () => {
      it("resolves the trace-level output to the FULL value, not the preview", async () => {
        setupGetAllWithSpansMocks();
        const { blobStore, getFromEventLog } = makeEventRefBlobStore();
        const service = buildService(blobStore);

        const result = await service.getAllTracesForProject(
          baseInput,
          protections,
          { includeSpans: false, resolveBlobs: true },
        );

        const trace = result!.groups.flat()[0]!;
        expect(getFromEventLog).toHaveBeenCalled();
        expect(trace.output?.value).toBe(FULL_OUTPUT);
      });

      it("emits no spans (the caller asked for a summary)", async () => {
        setupGetAllWithSpansMocks();
        const { blobStore } = makeEventRefBlobStore();
        const service = buildService(blobStore);

        const result = await service.getAllTracesForProject(
          baseInput,
          protections,
          { includeSpans: false, resolveBlobs: true },
        );

        const trace = result!.groups.flat()[0]!;
        expect(trace.spans ?? []).toEqual([]);
      });
    });
  });
});

// ---------------------------------------------------------------------------
// AC5 — list/search grid keeps preview, ZERO event_log reads
// ---------------------------------------------------------------------------

describe("ClickHouseTraceService.getAllTracesForProject — #4991 AC5 list protection", () => {
  describe("given the SAME offloaded trace but the list path (no resolveBlobs)", () => {
    describe("when includeSpans is requested without resolveBlobs", () => {
      it("issues ZERO event_log reads", async () => {
        setupGetAllWithSpansMocks();
        const { blobStore, getFromEventLog } = makeEventRefBlobStore();
        const service = buildService(blobStore);

        await service.getAllTracesForProject(baseInput, protections, {
          includeSpans: true,
        });

        expect(getFromEventLog).not.toHaveBeenCalled();
      });

      it("keeps the ≤64 KB preview (does not widen to the full value)", async () => {
        setupGetAllWithSpansMocks();
        const { blobStore } = makeEventRefBlobStore();
        const service = buildService(blobStore);

        const result = await service.getAllTracesForProject(
          baseInput,
          protections,
          { includeSpans: true },
        );

        // Falsifiable: assert the exact preview, not merely "not the full value"
        // (a broken mapper returning "" / null would slip past not.toBe).
        expect(result!.groups.flat()[0]!.output?.value).toBe(PREVIEW_OUTPUT);
      });
    });
  });
});

// ---------------------------------------------------------------------------
// AC2 — thread-detail resolves full
// ---------------------------------------------------------------------------

describe("ClickHouseTraceService.getTracesByThreadId — #4991 AC2 thread detail", () => {
  describe("given an offloaded trace in the thread and resolveBlobs", () => {
    describe("when the thread-detail path reads it", () => {
      it("reads the full conversation value back from event_log", async () => {
        setupThreadMocks();
        const { blobStore, getFromEventLog } = makeEventRefBlobStore();
        const service = buildService(blobStore);

        const traces = await service.getTracesByThreadId(
          PROJECT_ID,
          "thread-1",
          protections,
          { resolveBlobs: true },
        );

        expect(getFromEventLog).toHaveBeenCalled();
        expect(traces![0]!.output?.value).toBe(FULL_OUTPUT);
      });
    });

    describe("when the thread-detail path reads it WITHOUT resolveBlobs", () => {
      it("issues ZERO event_log reads and keeps the preview", async () => {
        setupThreadMocks();
        const { blobStore, getFromEventLog } = makeEventRefBlobStore();
        const service = buildService(blobStore);

        const traces = await service.getTracesByThreadId(
          PROJECT_ID,
          "thread-1",
          protections,
        );

        expect(getFromEventLog).not.toHaveBeenCalled();
        // Falsifiable: exact preview, not merely "not the full value".
        expect(traces![0]!.output?.value).toBe(PREVIEW_OUTPUT);
      });
    });
  });
});
