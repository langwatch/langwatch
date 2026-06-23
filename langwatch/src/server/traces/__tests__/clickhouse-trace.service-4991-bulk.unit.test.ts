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
import type { Protections } from "~/server/elasticsearch/protections";
import { createLogger } from "~/utils/logger/server";
import { ClickHouseTraceService } from "../clickhouse-trace.service";
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

/** Mocks the getTracesByThreadId query sequence (DISTINCT TraceId, then joined). */
function setupThreadMocks() {
  mockClickHouseQuery
    // SELECT DISTINCT TraceId (JSONEachRow → result.json())
    .mockResolvedValueOnce({
      json: () => Promise.resolve([{ TraceId: TRACE_ID }]),
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
