/**
 * Integration-flavored tests for TraceService.getTracesWithSpans with blob
 * resolution wired in (ADR-022). Uses a fake BlobStore (getFromEventLog stub)
 * and the real TraceIOExtractionService to verify that the resolution pipeline
 * accepts the updated deps shape and delegates correctly.
 *
 * "Integration-flavored": real TraceIOExtractionService, fake BlobStore,
 * controlled ClickHouseTraceService (in-process fake — no ClickHouse infra).
 *
 * BDD structure: given/when nested describes, action-based it() names.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BlobStore } from "~/server/app-layer/traces/blob-store.service";
import { BlobNotFoundError } from "~/server/app-layer/traces/blob-store.service";
import { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import type { Protections } from "~/server/elasticsearch/protections";
import type { Trace } from "~/server/tracer/types";
import { TraceService } from "../trace.service";

// ---------------------------------------------------------------------------
// Hoisted mocks — keep ClickHouseTraceService and other deps out of band
// ---------------------------------------------------------------------------
const {
  mockGetTracesWithSpansCH,
  mockGetTracesByThreadIdCH,
  mockGetTracesWithSpansByThreadIdsCH,
  mockResolveTraceIdByPrefixCH,
} = vi.hoisted(() => ({
  mockGetTracesWithSpansCH: vi.fn(),
  mockGetTracesByThreadIdCH: vi.fn(),
  mockGetTracesWithSpansByThreadIdsCH: vi.fn(),
  mockResolveTraceIdByPrefixCH: vi.fn(),
}));

const mockClickHouseInstance = {
  getTracesWithSpans: mockGetTracesWithSpansCH,
  getTracesByThreadId: mockGetTracesByThreadIdCH,
  getTracesWithSpansByThreadIds: mockGetTracesWithSpansByThreadIdsCH,
  resolveTraceIdByPrefix: mockResolveTraceIdByPrefixCH,
  getAllTracesForProject: vi.fn(),
  getTopicCounts: vi.fn(),
  getCustomersAndLabels: vi.fn(),
  getDistinctFieldNames: vi.fn(),
  getSpanForPromptStudio: vi.fn(),
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
// Helpers
// ---------------------------------------------------------------------------

const protections: Protections = {
  canSeeCosts: true,
  canSeePiiData: true,
  canSeeTopics: true,
} as Protections;

const fullOutput =
  "This is the full 50 KB output value that was offloaded to event_log during ingestion";

/**
 * Builds a fake BlobStore whose getFromEventLog resolves from a static contents map.
 * No S3 interaction — pure in-memory for fast unit tests.
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

/**
 * Builds a fake Trace that carries the offloaded-span preview as trace.output
 * (simulating what ClickHouseTraceService returns when the fold wrote a preview).
 */
function makeTraceWithPreview(): Trace {
  return {
    trace_id: "trace-1",
    project_id: "proj-1",
    metadata: {},
    timestamps: { started_at: 0, inserted_at: 0, updated_at: 0 },
    input: undefined,
    output: { value: "preview…" },
    spans: [
      {
        span_id: "span-1",
        trace_id: "trace-1",
        type: "span",
        name: "test",
        timestamps: { started_at: 0, finished_at: 1000 },
        params: {
          langwatch: {
            output: "preview…",
          },
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TraceService.getTracesWithSpans() — ADR-022 blob resolution pipeline", () => {
  let service: TraceService;
  let blobStore: BlobStore;
  let ioExtractionService: TraceIOExtractionService;

  beforeEach(() => {
    vi.clearAllMocks();
    blobStore = makeEventRefBlobStore({ "langwatch.output": fullOutput });
    ioExtractionService = new TraceIOExtractionService();

    service = new TraceService({} as any, { blobStore, ioExtractionService });
  });

  describe("given ClickHouse returns a trace with offloaded-span preview output", () => {
    describe("when getTracesWithSpans is called", () => {
      beforeEach(() => {
        mockGetTracesWithSpansCH.mockResolvedValue([makeTraceWithPreview()]);
      });

      it("returns the trace from ClickHouseTraceService", async () => {
        const traces = await service.getTracesWithSpans(
          "proj-1",
          ["trace-1"],
          protections,
        );

        expect(traces).toHaveLength(1);
        expect(traces[0]!.trace_id).toBe("trace-1");
      });

      it("delegates trace fetching to ClickHouseTraceService", async () => {
        const traces = await service.getTracesWithSpans(
          "proj-1",
          ["trace-1"],
          protections,
        );

        // #4888: TraceService forwards the per-call blob-resolution gate to CH.
        // No `full` was passed, so resolveBlobs is undefined (preview).
        expect(mockGetTracesWithSpansCH).toHaveBeenCalledWith(
          "proj-1",
          ["trace-1"],
          protections,
          { resolveBlobs: undefined },
        );
        expect(traces[0]!.trace_id).toBe("trace-1");
      });

      it("constructs successfully without throwing when blob deps are provided", () => {
        // Constructing TraceService with ADR-022 deps (blobStore + ioExtractionService)
        // should not throw. The production wiring (presets.ts) exercises this path.
        expect(
          () => new TraceService({} as any, { blobStore, ioExtractionService }),
        ).not.toThrow();
      });
    });
  });

  describe("given ClickHouse returns an empty trace list", () => {
    describe("when getTracesWithSpans is called", () => {
      it("returns an empty array without errors", async () => {
        mockGetTracesWithSpansCH.mockResolvedValue([]);

        const traces = await service.getTracesWithSpans(
          "proj-1",
          [],
          protections,
        );

        expect(traces).toEqual([]);
      });
    });
  });

  describe("given ClickHouse returns null (ClickHouse unavailable)", () => {
    describe("when getTracesWithSpans is called", () => {
      it("throws a descriptive error", async () => {
        mockGetTracesWithSpansCH.mockResolvedValue(null);

        await expect(
          service.getTracesWithSpans("proj-1", ["trace-1"], protections),
        ).rejects.toThrow("ClickHouse is enabled but returned null");
      });
    });
  });
});
