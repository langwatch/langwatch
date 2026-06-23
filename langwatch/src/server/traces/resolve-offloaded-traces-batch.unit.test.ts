/**
 * Unit tests for resolveOffloadedTracesBatch — the BULK read-path resolver
 * (#4991, "2 of 2" of #4888). Where resolveOffloadedTraces resolves one trace's
 * spans (detail reads, #4984), this resolves a WHOLE result set (export, thread,
 * annotation, sample builders) with a single bounded-concurrency pass over
 * event_log so a large export never fires an unbounded N×M burst of CH reads.
 *
 * AC6 — resolution is streamed: peak concurrent event_log reads is bounded by a
 *        constant regardless of result-set size; identical refs are deduped.
 * AC7 — a failed resolution degrades to the preview WITH a warn log (no silent
 *        truncation), per-ref, without failing the rest of the batch.
 *
 * BDD structure: given/when nested describes, action-based it() names.
 */
import { describe, it, expect, vi } from "vitest";

// TraceIOExtractionService wraps its methods in getLangWatchTracer spans.
vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: (
      _name: string,
      _opts: unknown,
      fn: (span: { setAttributes: () => void }) => unknown,
    ) => fn({ setAttributes: () => {} }),
  }),
}));

import type { BlobStore } from "~/server/app-layer/traces/blob-store.service";
import { BlobNotFoundError } from "~/server/app-layer/traces/blob-store.service";
import { EVENTREF_ATTR_PREFIX } from "~/server/app-layer/traces/lean-for-projection";
import { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import {
  NormalizedSpanKind,
  NormalizedStatusCode,
  type NormalizedSpan,
} from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";
import {
  EVENT_LOG_RESOLVE_CONCURRENCY,
  resolveOffloadedTracesBatch,
} from "./resolve-offloaded-traces-batch";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSpan(
  overrides: Partial<NormalizedSpan> & {
    spanAttributes?: Record<string, unknown>;
  } = {},
): NormalizedSpan {
  return {
    id: "span-1",
    traceId: "trace-1",
    spanId: "span-1",
    tenantId: "proj-1",
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
    spanAttributes: {},
    events: [],
    links: [],
    statusMessage: null,
    statusCode: NormalizedStatusCode.OK,
    instrumentationScope: { name: "test", version: null },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
    ...overrides,
  };
}

/** A span carrying an output eventref pointer (preview + reserved ref key). */
function makeSpanWithOutputRef({
  traceId,
  spanId,
  eventId,
  preview = "preview…",
}: {
  traceId: string;
  spanId: string;
  eventId: string;
  preview?: string;
}): NormalizedSpan {
  return makeSpan({
    traceId,
    spanId,
    spanAttributes: {
      "langwatch.output": preview,
      [`${EVENTREF_ATTR_PREFIX}langwatch.output`]: JSON.stringify({
        field: "langwatch.output",
        eventId,
      }),
    },
  });
}

function createMockLogger() {
  return {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
}

/**
 * A BlobStore whose getFromEventLog tracks in-flight concurrency so the test can
 * assert the resolver never exceeds the pool size. Each call resolves after a
 * microtask delay so overlapping calls are observable.
 */
function makeConcurrencyTrackingBlobStore(fullValue: string): {
  blobStore: BlobStore;
  getCalls: () => number;
  peakConcurrency: () => number;
} {
  let inFlight = 0;
  let peak = 0;
  let calls = 0;
  const getFromEventLog = vi.fn(async () => {
    calls++;
    inFlight++;
    peak = Math.max(peak, inFlight);
    // Yield several microtasks so concurrent calls actually overlap.
    await new Promise((r) => setTimeout(r, 1));
    inFlight--;
    return fullValue;
  });
  return {
    blobStore: {
      getFromEventLog,
      putSpool: vi.fn(),
      getSpool: vi.fn(),
      deleteSpool: vi.fn(),
    } as unknown as BlobStore,
    getCalls: () => calls,
    peakConcurrency: () => peak,
  };
}

const realIOService = new TraceIOExtractionService();

// ---------------------------------------------------------------------------
// AC6 — streamed / bounded-concurrency resolution
// ---------------------------------------------------------------------------

describe("resolveOffloadedTracesBatch() — AC6 bounded resolution", () => {
  describe("given a large result set where every trace has one offloaded span", () => {
    const TRACE_COUNT = EVENT_LOG_RESOLVE_CONCURRENCY * 3;
    const fullValue = "X".repeat(100_000);

    function buildResultSet(): NormalizedSpan[][] {
      return Array.from({ length: TRACE_COUNT }, (_v, i) => [
        makeSpanWithOutputRef({
          traceId: `trace-${i}`,
          spanId: `span-${i}`,
          eventId: `evt-${i}`,
        }),
      ]);
    }

    describe("when resolved as a batch", () => {
      it("never exceeds the configured event_log read concurrency", async () => {
        const { blobStore, peakConcurrency } =
          makeConcurrencyTrackingBlobStore(fullValue);

        await resolveOffloadedTracesBatch({
          projectId: "proj-1",
          spansPerTrace: buildResultSet(),
          blobStore,
          ioExtractionService: realIOService,
          logger: createMockLogger(),
        });

        expect(peakConcurrency()).toBeGreaterThan(0);
        expect(peakConcurrency()).toBeLessThanOrEqual(
          EVENT_LOG_RESOLVE_CONCURRENCY,
        );
      });

      it("issues exactly one event_log read per offloaded field (no N×M blow-up)", async () => {
        const { blobStore, getCalls } =
          makeConcurrencyTrackingBlobStore(fullValue);

        await resolveOffloadedTracesBatch({
          projectId: "proj-1",
          spansPerTrace: buildResultSet(),
          blobStore,
          ioExtractionService: realIOService,
          logger: createMockLogger(),
        });

        expect(getCalls()).toBe(TRACE_COUNT);
      });

      it("returns one resolution entry per input trace, in order, all resolved", async () => {
        const { blobStore } = makeConcurrencyTrackingBlobStore(fullValue);

        const results = await resolveOffloadedTracesBatch({
          projectId: "proj-1",
          spansPerTrace: buildResultSet(),
          blobStore,
          ioExtractionService: realIOService,
          logger: createMockLogger(),
        });

        expect(results).toHaveLength(TRACE_COUNT);
        expect(results.every((r) => r.anyResolved)).toBe(true);
        expect(
          results[0]!.resolvedSpans[0]!.spanAttributes["langwatch.output"],
        ).toBe(fullValue);
      });
    });
  });

  describe("given the same trace referenced twice in one result set", () => {
    const fullValue = "shared-full-value";

    describe("when resolved as a batch", () => {
      it("dedupes identical (eventId, field) refs into a single event_log read", async () => {
        const { blobStore, getCalls } =
          makeConcurrencyTrackingBlobStore(fullValue);
        const span = makeSpanWithOutputRef({
          traceId: "trace-dup",
          spanId: "span-dup",
          eventId: "evt-dup",
        });

        const results = await resolveOffloadedTracesBatch({
          projectId: "proj-1",
          spansPerTrace: [[span], [span]],
          blobStore,
          ioExtractionService: realIOService,
          logger: createMockLogger(),
        });

        expect(getCalls()).toBe(1);
        // Both output traces still receive the full value.
        expect(
          results[0]!.resolvedSpans[0]!.spanAttributes["langwatch.output"],
        ).toBe(fullValue);
        expect(
          results[1]!.resolvedSpans[0]!.spanAttributes["langwatch.output"],
        ).toBe(fullValue);
      });
    });
  });

  describe("given a trace with no offloaded spans", () => {
    describe("when resolved as a batch", () => {
      it("issues zero event_log reads and returns the spans untouched", async () => {
        const { blobStore, getCalls } =
          makeConcurrencyTrackingBlobStore("unused");
        const plainSpan = makeSpan({
          traceId: "trace-plain",
          spanAttributes: { "langwatch.output": "small inline value" },
        });

        const results = await resolveOffloadedTracesBatch({
          projectId: "proj-1",
          spansPerTrace: [[plainSpan]],
          blobStore,
          ioExtractionService: realIOService,
          logger: createMockLogger(),
        });

        expect(getCalls()).toBe(0);
        expect(results[0]!.anyResolved).toBe(false);
        expect(
          results[0]!.resolvedSpans[0]!.spanAttributes["langwatch.output"],
        ).toBe("small inline value");
      });
    });
  });
});

// ---------------------------------------------------------------------------
// AC7 — degrade to preview WITH a warn log
// ---------------------------------------------------------------------------

describe("resolveOffloadedTracesBatch() — AC7 graceful degradation", () => {
  describe("given one trace whose event_log row is missing", () => {
    function makeMissingRowBlobStore(): BlobStore {
      return {
        getFromEventLog: vi.fn(async ({ field }: { field: string }) => {
          throw new BlobNotFoundError("evt-missing", field, "proj-1");
        }),
        putSpool: vi.fn(),
        getSpool: vi.fn(),
        deleteSpool: vi.fn(),
      } as unknown as BlobStore;
    }

    describe("when resolved as a batch", () => {
      it("keeps the preview value for the unresolved field", async () => {
        const logger = createMockLogger();
        const results = await resolveOffloadedTracesBatch({
          projectId: "proj-1",
          spansPerTrace: [
            [
              makeSpanWithOutputRef({
                traceId: "trace-x",
                spanId: "span-x",
                eventId: "evt-missing",
                preview: "the 64KB preview",
              }),
            ],
          ],
          blobStore: makeMissingRowBlobStore(),
          ioExtractionService: realIOService,
          logger,
        });

        expect(
          results[0]!.resolvedSpans[0]!.spanAttributes["langwatch.output"],
        ).toBe("the 64KB preview");
        expect(results[0]!.anyResolved).toBe(false);
      });

      it("logs a warning (no silent truncation)", async () => {
        const logger = createMockLogger();
        await resolveOffloadedTracesBatch({
          projectId: "proj-1",
          spansPerTrace: [
            [
              makeSpanWithOutputRef({
                traceId: "trace-x",
                spanId: "span-x",
                eventId: "evt-missing",
              }),
            ],
          ],
          blobStore: makeMissingRowBlobStore(),
          ioExtractionService: realIOService,
          logger,
        });

        expect(logger.warn).toHaveBeenCalled();
      });

      it("strips the reserved eventref key even when resolution fails", async () => {
        const logger = createMockLogger();
        const results = await resolveOffloadedTracesBatch({
          projectId: "proj-1",
          spansPerTrace: [
            [
              makeSpanWithOutputRef({
                traceId: "trace-x",
                spanId: "span-x",
                eventId: "evt-missing",
              }),
            ],
          ],
          blobStore: makeMissingRowBlobStore(),
          ioExtractionService: realIOService,
          logger,
        });

        const keys = Object.keys(
          results[0]!.resolvedSpans[0]!.spanAttributes,
        );
        expect(keys.every((k) => !k.startsWith(EVENTREF_ATTR_PREFIX))).toBe(
          true,
        );
      });
    });
  });

  describe("given a result set where one trace fails and others succeed", () => {
    function makeSelectiveBlobStore(goodValue: string): BlobStore {
      return {
        getFromEventLog: vi.fn(
          async ({ eventId, field }: { eventId: string; field: string }) => {
            if (eventId === "evt-bad") {
              throw new BlobNotFoundError(eventId, field, "proj-1");
            }
            return goodValue;
          },
        ),
        putSpool: vi.fn(),
        getSpool: vi.fn(),
        deleteSpool: vi.fn(),
      } as unknown as BlobStore;
    }

    describe("when resolved as a batch", () => {
      it("resolves the healthy traces and degrades only the failing one", async () => {
        const goodValue = "Y".repeat(80_000);
        const results = await resolveOffloadedTracesBatch({
          projectId: "proj-1",
          spansPerTrace: [
            [
              makeSpanWithOutputRef({
                traceId: "trace-good",
                spanId: "span-good",
                eventId: "evt-good",
              }),
            ],
            [
              makeSpanWithOutputRef({
                traceId: "trace-bad",
                spanId: "span-bad",
                eventId: "evt-bad",
                preview: "bad-preview",
              }),
            ],
          ],
          blobStore: makeSelectiveBlobStore(goodValue),
          ioExtractionService: realIOService,
          logger: createMockLogger(),
        });

        expect(results[0]!.anyResolved).toBe(true);
        expect(
          results[0]!.resolvedSpans[0]!.spanAttributes["langwatch.output"],
        ).toBe(goodValue);
        expect(results[1]!.anyResolved).toBe(false);
        expect(
          results[1]!.resolvedSpans[0]!.spanAttributes["langwatch.output"],
        ).toBe("bad-preview");
      });
    });
  });
});
