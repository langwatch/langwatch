/**
 * #5753 — getSpanForPromptStudio bypassed blob resolution, returning the
 * truncated 64 KB preview instead of the full offloaded value. The fix
 * wires the per-trace resolver into the prompt-studio read path and
 * resolves the target LLM span's attributes before extraction.
 *
 * ACs covered here:
 *   AC1 — getSpanForPromptStudio resolves offloaded eventref IO to the
 *         FULL value before returning the prompt-studio result.
 *   AC2 — Multitenancy preserved (tenant-scoped resolution).
 *   AC3 — Covered by a test proving an over-threshold span IO opens
 *         full in prompt studio.
 *
 * BDD structure: given/when nested describes, action-based it() names.
 */
import { createLogger } from "@langwatch/observability";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EVENTREF_ATTR_PREFIX,
  IO_PREVIEW_BYTES,
} from "~/server/app-layer/traces/lean-for-projection";
import type { BlobStore } from "~/server/app-layer/traces/blob-store.service";
import { BlobNotFoundError } from "~/server/app-layer/traces/blob-store.service";
import { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import type { Protections } from "~/server/traces/protections";
import { ClickHouseTraceService } from "../clickhouse-trace.service";
import { resolveOffloadedTraces } from "../resolve-offloaded-traces";
import { resolveOffloadedTracesBatch } from "../resolve-offloaded-traces-batch";

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

const LARGE_BYTE_COUNT = 400_000;
const FULL_OUTPUT = "x".repeat(LARGE_BYTE_COUNT);
const PREVIEW_OUTPUT = "x".repeat(IO_PREVIEW_BYTES) + "…";

const PROJECT_ID = "proj-5753";
const TRACE_ID = "trace-5753";
const SPAN_ID = "span-5753-llm";

const protections: Protections = {
  canSeeCosts: true,
  canSeePiiData: true,
  canSeeTopics: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
} as Protections;

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

/**
 * A stored_spans row carrying an offloaded langwatch.output eventref.
 *
 * Shape matches the columns getSpanForPromptStudio's SQL selects (SpanId,
 * TraceId, ParentSpanId, SpanName, SpanAttributes, StartTime, EndTime,
 * DurationMs, StatusCode, StatusMessage). `langwatch.span.type: "llm"`
 * is set so the requested-row fast path is taken (no findNearestLlm walk).
 */
function makeLlmSpanRowWithEventRef() {
  return {
    SpanId: SPAN_ID,
    TraceId: TRACE_ID,
    ParentSpanId: null,
    SpanName: "llm-call",
    SpanAttributes: {
      "langwatch.span.type": "llm",
      "langwatch.output": PREVIEW_OUTPUT,
      [`${EVENTREF_ATTR_PREFIX}langwatch.output`]: JSON.stringify({
        field: "langwatch.output",
        eventId: "evt-001",
      }),
    },
    StartTime: Date.now(),
    EndTime: Date.now() + 100,
    DurationMs: 100,
    StatusCode: 1,
    StatusMessage: "",
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

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// AC1 + AC2 + AC3 — over-threshold span IO opens full in prompt studio
// ---------------------------------------------------------------------------

describe("ClickHouseTraceService.getSpanForPromptStudio — #5753 blob resolution", () => {
  describe("given a >64 KB offloaded LLM span read via getSpanForPromptStudio", () => {
    describe("when the prompt-studio path reads it", () => {
      it("resolves the full output value from event_log (not the preview)", async () => {
        mockClickHouseQuery.mockResolvedValueOnce({
          json: () => Promise.resolve([makeLlmSpanRowWithEventRef()]),
        });
        const { blobStore, getFromEventLog } = makeEventRefBlobStore();
        const service = buildService(blobStore);

        const result = await service.getSpanForPromptStudio(
          PROJECT_ID,
          SPAN_ID,
          protections,
        );

        // AC2: tenant-scoped resolution — getFromEventLog receives the
        // caller's projectId as tenantId and the span's traceId as
        // aggregateId (ADR-022: aggregateId for the trace-processing
        // pipeline IS the traceId).
        expect(getFromEventLog).toHaveBeenCalledWith(
          expect.objectContaining({
            tenantId: PROJECT_ID,
            aggregateId: TRACE_ID,
            field: "langwatch.output",
            eventId: "evt-001",
          }),
        );

        // AC1 + AC3: the assistant message carries the FULL value, not
        // the 64 KB preview.
        const assistantMessage = result!.messages.find(
          (m) => m.role === "assistant",
        );
        expect(assistantMessage?.content).toBe(FULL_OUTPUT);
      });

      it("widens the prompt-studio output past the 64 KB preview", async () => {
        mockClickHouseQuery.mockResolvedValueOnce({
          json: () => Promise.resolve([makeLlmSpanRowWithEventRef()]),
        });
        const { blobStore } = makeEventRefBlobStore();
        const service = buildService(blobStore);

        const result = await service.getSpanForPromptStudio(
          PROJECT_ID,
          SPAN_ID,
          protections,
        );

        const assistantMessage = result!.messages.find(
          (m) => m.role === "assistant",
        );
        expect(
          Buffer.byteLength(assistantMessage!.content, "utf8"),
        ).toBeGreaterThan(IO_PREVIEW_BYTES);
      });
    });
  });

  // Safety net: a caller that hasn't wired buildTraceBlobResolutionDeps()
  // yet (e.g. a test fixture, a legacy code path) must keep working with
  // the preview, identical to pre-fix behavior. This is the no-resolver
  // branch of the `if (this.resolveTraceSpans)` guard.
  describe("given the SAME offloaded span but no resolver wired (legacy caller)", () => {
    describe("when getSpanForPromptStudio reads it", () => {
      it("keeps the preview value (graceful degradation, zero event_log reads)", async () => {
        mockClickHouseQuery.mockResolvedValueOnce({
          json: () => Promise.resolve([makeLlmSpanRowWithEventRef()]),
        });
        const { getFromEventLog } = makeEventRefBlobStore();
        // No resolver injected — simulates a caller that hasn't wired
        // buildTraceBlobResolutionDeps() yet.
        const service = new ClickHouseTraceService(
          { project: { findUnique: vi.fn() } } as never,
          undefined,
          undefined,
        );

        const result = await service.getSpanForPromptStudio(
          PROJECT_ID,
          SPAN_ID,
          protections,
        );

        expect(getFromEventLog).not.toHaveBeenCalled();
        const assistantMessage = result!.messages.find(
          (m) => m.role === "assistant",
        );
        // Falsifiable: exact preview, not merely "not the full value"
        // (a broken mapper returning "" / null would slip past not.toBe).
        expect(assistantMessage?.content).toBe(PREVIEW_OUTPUT);
      });
    });
  });
});
