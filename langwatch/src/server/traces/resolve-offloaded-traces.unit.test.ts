/**
 * Unit tests for the resolveOffloadedTraces helper — per-trace span-level
 * eventref resolution and TraceIO recompute (read-resolution half of ADR-022).
 * Each test covers one assertion.
 *
 * BDD structure: given/when nested describes, action-based it() names.
 */
import { describe, it, expect, vi } from "vitest";

// TraceIOExtractionService wraps its methods in getLangWatchTracer spans.
// Mock langwatch so the tracer's withActiveSpan is a passthrough in tests.
vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: (
      _name: string,
      _opts: unknown,
      fn: (span: { setAttributes: () => void }) => unknown,
    ) => fn({ setAttributes: () => {} }),
  }),
}));
import {
  NormalizedSpanKind,
  NormalizedStatusCode,
  type NormalizedSpan,
} from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";
import { EVENTREF_ATTR_PREFIX } from "~/server/app-layer/traces/lean-for-projection";
import type { BlobStore } from "~/server/app-layer/traces/blob-store.service";
import { BlobNotFoundError } from "~/server/app-layer/traces/blob-store.service";
import { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import { resolveOffloadedTraces } from "./resolve-offloaded-traces";

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

function createMockLogger() {
  return {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
}

/**
 * Creates a fake BlobStore whose getFromEventLog returns a pre-configured map
 * of field → fullValue for the given eventId / aggregateId combination.
 */
function fakeBlobStore(resolvedValues: Record<string, string>): BlobStore {
  return {
    getFromEventLog: vi.fn(async ({ field }: { eventId: string; field: string; tenantId: string; aggregateType: string; aggregateId: string }) => {
      if (field in resolvedValues) {
        return resolvedValues[field]!;
      }
      throw new BlobNotFoundError("evt-test", field, "proj-1");
    }),
    putSpool: vi.fn(),
    getSpool: vi.fn(),
    deleteSpool: vi.fn(),
  } as unknown as BlobStore;
}

const realIOService = new TraceIOExtractionService();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("resolveOffloadedTraces()", () => {
  describe("given a trace whose span has a reserved eventref pointer", () => {
    const fullOutput = "The full 50 KB output value that was offloaded via event_log";

    const spanWithRef = makeSpan({
      traceId: "trace-1",
      spanId: "span-1",
      spanAttributes: {
        "langwatch.output": "preview…",
        [`${EVENTREF_ATTR_PREFIX}langwatch.output`]:
          JSON.stringify({ field: "langwatch.output" }),
      },
    });

    describe("when resolved", () => {
      it("resolved span attributes contain the full value, not the preview", async () => {
        const blobSvc = fakeBlobStore({ "langwatch.output": fullOutput });
        const logger = createMockLogger();

        const result = await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanWithRef],
          blobStore: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        expect(
          result.resolvedSpans[0]!.spanAttributes["langwatch.output"],
        ).toBe(fullOutput);
      });

      it("reserved eventref keys are stripped from the resolved span attributes", async () => {
        const blobSvc = fakeBlobStore({ "langwatch.output": fullOutput });
        const logger = createMockLogger();

        const result = await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanWithRef],
          blobStore: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        const attrs = result.resolvedSpans[0]!.spanAttributes;
        const hasRef = Object.keys(attrs).some((k) =>
          k.startsWith(EVENTREF_ATTR_PREFIX),
        );
        expect(hasRef).toBe(false);
      });

      it("trace.output is recomputed from the full span value", async () => {
        const blobSvc = fakeBlobStore({ "langwatch.output": fullOutput });
        const logger = createMockLogger();

        const result = await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanWithRef],
          blobStore: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        expect(result.recomputedOutput?.text).toBe(fullOutput);
      });

      it("anyResolved is true", async () => {
        const blobSvc = fakeBlobStore({ "langwatch.output": fullOutput });
        const logger = createMockLogger();

        const result = await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanWithRef],
          blobStore: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        expect(result.anyResolved).toBe(true);
      });
    });
  });

  describe("given a trace with no eventref pointers in any span", () => {
    const spanClean = makeSpan({
      spanAttributes: {
        "langwatch.output": "a normal non-offloaded output",
      },
    });

    describe("when resolved", () => {
      it("returns spans unchanged", async () => {
        const blobSvc = fakeBlobStore({});
        const logger = createMockLogger();

        const result = await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanClean],
          blobStore: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        expect(result.resolvedSpans[0]).toBe(spanClean);
      });

      it("calls BlobStore.getFromEventLog zero times", async () => {
        const blobSvc = fakeBlobStore({});
        const getFromEventLogSpy = blobSvc.getFromEventLog as ReturnType<typeof vi.fn>;
        const logger = createMockLogger();

        await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanClean],
          blobStore: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        expect(getFromEventLogSpy).not.toHaveBeenCalled();
      });

      it("anyResolved is false", async () => {
        const blobSvc = fakeBlobStore({});
        const logger = createMockLogger();

        const result = await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanClean],
          blobStore: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        expect(result.anyResolved).toBe(false);
      });
    });
  });

  describe("given a missing event_log row (BlobStore.getFromEventLog throws BlobNotFoundError)", () => {
    const spanWithRef = makeSpan({
      traceId: "trace-1",
      spanId: "span-1",
      spanAttributes: {
        "langwatch.output": "preview…",
        [`${EVENTREF_ATTR_PREFIX}langwatch.output`]:
          JSON.stringify({ field: "langwatch.output" }),
      },
    });

    function failingBlobStore(): BlobStore {
      return {
        getFromEventLog: vi.fn(async () => {
          throw new BlobNotFoundError("evt-test", "langwatch.output", "proj-1");
        }),
        putSpool: vi.fn(),
        getSpool: vi.fn(),
        deleteSpool: vi.fn(),
      } as unknown as BlobStore;
    }

    describe("when resolved", () => {
      it("does not throw — returns normally", async () => {
        const blobSvc = failingBlobStore();
        const logger = createMockLogger();

        await expect(
          resolveOffloadedTraces({
            projectId: "proj-1",
            normalizedSpans: [spanWithRef],
            blobStore: blobSvc,
            ioExtractionService: realIOService,
            logger,
          }),
        ).resolves.not.toThrow();
      });

      it("keeps the preview value intact in the span attributes", async () => {
        const blobSvc = failingBlobStore();
        const logger = createMockLogger();

        const result = await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanWithRef],
          blobStore: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        expect(
          result.resolvedSpans[0]!.spanAttributes["langwatch.output"],
        ).toBe("preview…");
      });

      it("logs a warning at warn level", async () => {
        const blobSvc = failingBlobStore();
        const logger = createMockLogger();

        await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanWithRef],
          blobStore: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        expect(logger.warn).toHaveBeenCalledOnce();
      });

      it("anyResolved is false (span was not resolved)", async () => {
        const blobSvc = failingBlobStore();
        const logger = createMockLogger();

        const result = await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanWithRef],
          blobStore: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        expect(result.anyResolved).toBe(false);
      });
    });
  });

  describe("given a span with a reserved eventref attribute set to malformed JSON", () => {
    const spanWithMalformedRef = makeSpan({
      spanAttributes: {
        "langwatch.output": "preview…",
        [`${EVENTREF_ATTR_PREFIX}langwatch.output`]: 'not-json{',
      },
    });

    describe("when resolved", () => {
      it("strips the reserved eventref key from returned span attributes", async () => {
        const blobSvc = fakeBlobStore({});
        const logger = createMockLogger();

        const result = await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanWithMalformedRef],
          blobStore: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        const attrs = result.resolvedSpans[0]!.spanAttributes;
        const hasReservedKey = Object.keys(attrs).some((k) =>
          k.startsWith(EVENTREF_ATTR_PREFIX),
        );
        expect(hasReservedKey).toBe(false);
      });
    });
  });
});
