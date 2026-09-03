/**
 * Integration test for the large-trace blob offload pipeline (#4215 / ADR-022).
 *
 * Environment choice: in-process stubs only (no testcontainers, no real S3).
 *
 * Rationale: the goal of this test is pipeline WIRING, not S3 fidelity or
 * ClickHouse SQL correctness — those are separately covered by unit tests
 * (trace-blob-store.service.unit.test.ts, trace-offload-resolution.service.unit.test.ts).
 * The full pipeline wiring is exercised by:
 *   - Simulating the dispatch interposition: calling `leanForProjection` on a
 *     synthetic SpanReceived event whose IO attr exceeds IO_PREVIEW_BYTES.
 *   - Verifying the lean event carries the eventref pointer and the preview.
 *   - Feeding the lean span attributes directly into `resolveOffloadedTraces`
 *     backed by a fake BlobStore.getFromEventLog, which returns the full value.
 *   - Asserting TraceIOExtractionService recomputes trace.output correctly.
 *
 * This approach exercises every production module in the pipeline without
 * requiring infrastructure, and the assertions are identical to what the real
 * read path delivers.
 *
 * Was
 * `platform/app/src/server/app-layer/traces/__tests__/large-trace-blob-offload.integration.test.ts`.
 * `leanForProjection` now lives in `trace-projection-lean.service`,
 * `resolveOffloadedTraces` in `trace-offload-resolution.service`. The
 * "over-threshold command is spooled to S3" scenario is retired — see the
 * lane report.
 *
 * BDD structure: `describe("given …")` -> `describe("when …")` -> `it("…")`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// TraceIOExtractionService wraps its methods in getLangWatchTracer spans.
// Mock langwatch so the tracer's withActiveSpan is a passthrough in tests.
vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: (
      _name: string,
      _opts: unknown,
      fn: (span: {
        setAttribute: () => void;
        setAttributes: () => void;
        addEvent: () => void;
      }) => unknown,
    ) =>
      fn({
        setAttribute: () => {},
        setAttributes: () => {},
        addEvent: () => {},
      }),
  }),
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import type { Event } from "@langwatch/eventing";
import {
  EVENTREF_ATTR_PREFIX,
  type NormalizedSpan,
  NormalizedSpanKind,
  NormalizedStatusCode,
  SPAN_RECEIVED_EVENT_TYPE,
} from "@langwatch/trace-contract";
import { TraceCanonicalisationService } from "@langwatch/trace-server";
import type { BlobStore } from "../trace-blob-store.service";
import { BlobNotFoundError } from "../trace-blob-store.service";
import { IO_PREVIEW_BYTES, leanForProjection } from "../trace-projection-lean.service";
import { resolveOffloadedTraces, type WarnLogger } from "../trace-offload-resolution.service";
import { TraceIOExtractionService } from "../trace-io-extraction.service";

// ---------------------------------------------------------------------------
// Constants and helpers
// ---------------------------------------------------------------------------

const PROJECT_ID = "test-project-offload";
const TRACE_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaabb";
const SPAN_ID = "bbbbbbbbbbbbbbbb";

/** 1 MB string — well over the 64 KB IO_PREVIEW_BYTES threshold. */
const ONE_MB_OUTPUT = "x".repeat(1024 * 1024);

function ioExtractionService(): TraceIOExtractionService {
  return new TraceIOExtractionService(TraceCanonicalisationService.create());
}

/**
 * Builds a fake BlobStore whose getFromEventLog returns values from an in-memory map.
 * Simulates the event_log read path without a real ClickHouse instance.
 */
function makeEventLogBlobStore(contents: Record<string, string>): {
  blobStore: BlobStore;
  getFromEventLogSpy: ReturnType<typeof vi.fn>;
} {
  const getFromEventLogSpy = vi.fn(
    async ({ field }: { eventId: string; field: string; tenantId: string; aggregateType: string; aggregateId: string }) => {
      if (field in contents) return contents[field]!;
      throw new BlobNotFoundError("evt-test", field, PROJECT_ID);
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

/**
 * Builds a synthetic SpanReceived event whose langwatch.output is set to `output`.
 * This simulates the event written to event_log by the command worker.
 */
function makeSpanReceivedEvent({ output }: { output: string }): Event {
  return {
    type: SPAN_RECEIVED_EVENT_TYPE,
    id: "evt-1",
    tenantId: PROJECT_ID,
    aggregateId: TRACE_ID,
    aggregateType: "trace",
    occurredAt: Date.now(),
    data: {
      span: {
        traceId: TRACE_ID,
        spanId: SPAN_ID,
        name: "test-span",
        kind: 1,
        startTimeUnixNano: String(Date.now() * 1_000_000),
        endTimeUnixNano: String((Date.now() + 1000) * 1_000_000),
        attributes: [{ key: "langwatch.output", value: { stringValue: output } }],
        events: [],
        links: [],
        status: { code: 1, message: null },
        droppedAttributesCount: 0,
        droppedEventsCount: 0,
        droppedLinksCount: 0,
      },
      resource: { attributes: [] },
      instrumentationScope: { name: "test" },
    },
  } as unknown as Event;
}

/**
 * Extracts span attributes from a lean event (post-leanForProjection) into
 * the Record<string, string> format that NormalizedSpan.spanAttributes uses.
 */
function extractSpanAttrs(event: Event): Record<string, string> {
  const data = event.data as {
    span?: { attributes?: Array<{ key: string; value: { stringValue?: string } }> };
  };
  const attrs: Record<string, string> = {};
  for (const attr of data?.span?.attributes ?? []) {
    if (typeof attr.value.stringValue === "string") {
      attrs[attr.key] = attr.value.stringValue;
    }
  }
  return attrs;
}

/**
 * Builds a NormalizedSpan from a span attributes map, simulating what the
 * projection receives from the command worker after leanForProjection.
 */
function makeNormalizedSpan(spanAttributes: Record<string, string>): NormalizedSpan {
  return {
    id: SPAN_ID,
    traceId: TRACE_ID,
    spanId: SPAN_ID,
    tenantId: PROJECT_ID,
    parentSpanId: null,
    parentTraceId: null,
    parentIsRemote: null,
    sampled: true,
    startTimeUnixMs: 0,
    endTimeUnixMs: 1000,
    durationMs: 1000,
    name: "test-span",
    kind: NormalizedSpanKind.INTERNAL,
    resourceAttributes: {},
    spanAttributes,
    events: [],
    links: [],
    statusMessage: null,
    statusCode: NormalizedStatusCode.OK,
    instrumentationScope: { name: "test", version: null },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
    cost: null,
    nonBilledCost: null,
  };
}

// ---------------------------------------------------------------------------
// leanForProjection + resolveOffloadedTraces pipeline
// ---------------------------------------------------------------------------

describe("given a span field value exceeds the offload threshold (IO_PREVIEW_BYTES)", () => {
  let leanAttrs: Record<string, string>;

  beforeEach(() => {
    const fullEvent = makeSpanReceivedEvent({ output: ONE_MB_OUTPUT });
    const leanEvent = leanForProjection(fullEvent);
    leanAttrs = extractSpanAttrs(leanEvent);
  });

  describe("when leanForProjection is applied (simulating dispatch interposition)", () => {
    /** @scenario event_log carries the full event content; projection queue carries the lean shape */
    it("the lean event carries a preview within the IO_PREVIEW_BYTES budget for langwatch.output", () => {
      const previewValue = leanAttrs["langwatch.output"] ?? "";
      expect(Buffer.byteLength(previewValue, "utf-8")).toBeLessThanOrEqual(
        IO_PREVIEW_BYTES + 4, // +4 bytes for the ellipsis character "…" (3 bytes UTF-8)
      );
      expect(Buffer.byteLength(previewValue, "utf-8")).toBeLessThan(Buffer.byteLength(ONE_MB_OUTPUT, "utf-8"));
    });

    it("the lean event carries a reserved eventref attribute for langwatch.output", () => {
      const eventrefKey = `${EVENTREF_ATTR_PREFIX}langwatch.output`;
      expect(leanAttrs[eventrefKey]).toBeDefined();
      const ref = JSON.parse(leanAttrs[eventrefKey]!) as { field: string };
      expect(ref.field).toBe("langwatch.output");
    });

    it("the lean event carries no full content (output value is truncated)", () => {
      const previewValue = leanAttrs["langwatch.output"] ?? "";
      expect(previewValue).not.toBe(ONE_MB_OUTPUT);
    });
  });

  describe("when the lean span is resolved via resolveOffloadedTraces backed by event_log", () => {
    let resolvedResult: Awaited<ReturnType<typeof resolveOffloadedTraces>>;
    let getFromEventLogSpy: ReturnType<typeof vi.fn>;
    let logger: WarnLogger;

    beforeEach(async () => {
      const { blobStore, getFromEventLogSpy: spy } = makeEventLogBlobStore({
        "langwatch.output": ONE_MB_OUTPUT,
      });
      getFromEventLogSpy = spy;
      logger = { warn: vi.fn(), error: vi.fn() };

      const normalizedSpan = makeNormalizedSpan(leanAttrs);

      resolvedResult = await resolveOffloadedTraces({
        projectId: PROJECT_ID,
        normalizedSpans: [normalizedSpan],
        blobStore,
        ioExtractionService: ioExtractionService(),
        logger,
      });
    });

    /** @scenario An online evaluator on an over-threshold trace receives the full output */
    it("the returned span's langwatch.output is the full value byte-identical to the original", () => {
      const resolvedAttrValue = resolvedResult.resolvedSpans[0]?.spanAttributes?.["langwatch.output"];
      expect(resolvedAttrValue).toBe(ONE_MB_OUTPUT);
    });

    it("the reserved eventref attribute is stripped from the returned span attributes", () => {
      const attrs = resolvedResult.resolvedSpans[0]?.spanAttributes ?? {};
      const hasRef = Object.keys(attrs).some((k) => k.startsWith(EVENTREF_ATTR_PREFIX));
      expect(hasRef).toBe(false);
    });

    /** @scenario Trace-detail collapsed uses preview; "show full" JOINs event_log */
    it("the recomputed trace.output (via TraceIOExtractionService) is the full value, not the preview", () => {
      expect(resolvedResult.recomputedOutput).not.toBeNull();
      expect(resolvedResult.recomputedOutput!.text).toBe(ONE_MB_OUTPUT);
    });

    it("anyResolved is true", () => {
      expect(resolvedResult.anyResolved).toBe(true);
    });

    it("BlobStore.getFromEventLog is called once for the langwatch.output field", () => {
      expect(getFromEventLogSpy).toHaveBeenCalledOnce();
      expect(getFromEventLogSpy).toHaveBeenCalledWith(
        expect.objectContaining({ field: "langwatch.output", tenantId: PROJECT_ID }),
      );
    });
  });
});

// ---------------------------------------------------------------------------
// flag-off path: no lean, no resolution
// ---------------------------------------------------------------------------

describe("given the span output is below IO_PREVIEW_BYTES (flag-off / sub-threshold)", () => {
  const SMALL_OUTPUT = "small output value";

  let leanAttrs: Record<string, string>;

  beforeEach(() => {
    const fullEvent = makeSpanReceivedEvent({ output: SMALL_OUTPUT });
    // leanForProjection is a no-op for sub-threshold values
    const leanEvent = leanForProjection(fullEvent);
    leanAttrs = extractSpanAttrs(leanEvent);
  });

  describe("when leanForProjection is applied", () => {
    it("the event is returned unchanged (same object reference)", () => {
      const fullEvent = makeSpanReceivedEvent({ output: SMALL_OUTPUT });
      const result = leanForProjection(fullEvent);
      expect(result).toBe(fullEvent);
    });

    it("no eventref attribute is present in the lean attrs", () => {
      const hasRef = Object.keys(leanAttrs).some((k) => k.startsWith(EVENTREF_ATTR_PREFIX));
      expect(hasRef).toBe(false);
    });
  });

  describe("when resolved via resolveOffloadedTraces", () => {
    /** @scenario With the flag off, ingestion and reads behave exactly as before */
    it("returns spans unchanged and calls getFromEventLog zero times", async () => {
      const { blobStore, getFromEventLogSpy } = makeEventLogBlobStore({});
      const logger = { warn: vi.fn(), error: vi.fn() };

      const normalizedSpan = makeNormalizedSpan(leanAttrs);

      const result = await resolveOffloadedTraces({
        projectId: PROJECT_ID,
        normalizedSpans: [normalizedSpan],
        blobStore,
        ioExtractionService: ioExtractionService(),
        logger,
      });

      // Span is returned as-is (same reference — fast path)
      expect(result.resolvedSpans[0]).toBe(normalizedSpan);

      // getFromEventLog is never called
      expect(getFromEventLogSpy).not.toHaveBeenCalled();

      // anyResolved is false
      expect(result.anyResolved).toBe(false);

      // Full value preserved
      expect(result.resolvedSpans[0]?.spanAttributes?.["langwatch.output"]).toBe(SMALL_OUTPUT);
    });
  });
});

// ---------------------------------------------------------------------------
// stale event_log row (BlobNotFoundError on read)
// ---------------------------------------------------------------------------

describe("given the span was offloaded but the event_log row is missing on read (stale ref)", () => {
  let leanAttrs: Record<string, string>;
  let previewValue: string;

  beforeEach(() => {
    const fullEvent = makeSpanReceivedEvent({ output: ONE_MB_OUTPUT });
    const leanEvent = leanForProjection(fullEvent);
    leanAttrs = extractSpanAttrs(leanEvent);
    previewValue = leanAttrs["langwatch.output"] ?? "";
  });

  describe("when getFromEventLog throws BlobNotFoundError", () => {
    it("does not throw to the caller", async () => {
      const { blobStore } = makeEventLogBlobStore({}); // empty — will throw BlobNotFoundError
      const logger = { warn: vi.fn(), error: vi.fn() };
      const normalizedSpan = makeNormalizedSpan(leanAttrs);

      await expect(
        resolveOffloadedTraces({
          projectId: PROJECT_ID,
          normalizedSpans: [normalizedSpan],
          blobStore,
          ioExtractionService: ioExtractionService(),
          logger,
        }),
      ).resolves.not.toThrow();
    });

    it("returns the preview value (not the full value)", async () => {
      const { blobStore } = makeEventLogBlobStore({});
      const logger = { warn: vi.fn(), error: vi.fn() };
      const normalizedSpan = makeNormalizedSpan(leanAttrs);

      const result = await resolveOffloadedTraces({
        projectId: PROJECT_ID,
        normalizedSpans: [normalizedSpan],
        blobStore,
        ioExtractionService: ioExtractionService(),
        logger,
      });

      const returnedValue = result.resolvedSpans[0]?.spanAttributes?.["langwatch.output"];
      expect(returnedValue).toBe(previewValue);
      // Preview is shorter than the original 1 MB value
      expect((returnedValue as string).length).toBeLessThan(ONE_MB_OUTPUT.length);
    });

    it("logs at warn level (not error or silent)", async () => {
      const { blobStore } = makeEventLogBlobStore({});
      const logger = { warn: vi.fn(), error: vi.fn() };
      const normalizedSpan = makeNormalizedSpan(leanAttrs);

      await resolveOffloadedTraces({
        projectId: PROJECT_ID,
        normalizedSpans: [normalizedSpan],
        blobStore,
        ioExtractionService: ioExtractionService(),
        logger,
      });

      expect(logger.warn).toHaveBeenCalledOnce();
    });

    it("anyResolved is false (the span was not resolved)", async () => {
      const { blobStore } = makeEventLogBlobStore({});
      const logger = { warn: vi.fn(), error: vi.fn() };
      const normalizedSpan = makeNormalizedSpan(leanAttrs);

      const result = await resolveOffloadedTraces({
        projectId: PROJECT_ID,
        normalizedSpans: [normalizedSpan],
        blobStore,
        ioExtractionService: ioExtractionService(),
        logger,
      });

      expect(result.anyResolved).toBe(false);
    });
  });
});
