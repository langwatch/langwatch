import { beforeEach, describe, expect, it, vi } from "vitest";

import { TraceCanonicalisationService } from "#services/trace-canonicalisation.service";

/**
 * @see ADR-022
 * Per-trace resolution: eventref resolution and TraceIO recomputation for
 * read paths.
 */
import { TraceOffloadResolutionService } from "../../trace-offload-resolution.service.ts";

// TraceIOExtractionService wraps its methods in getLangWatchTracer spans.
// Mock langwatch so the tracer's withActiveSpan is a passthrough in tests.
vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: (
      _name: string,
      _opts: unknown,
      fn: (span: { setAttributes: () => void }) => unknown,
    ) => fn({ setAttributes: () => undefined }),
  }),
}));

import {
  EVENTREF_ATTR_PREFIX,
  type NormalizedSpan,
  NormalizedSpanKind,
  NormalizedStatusCode,
} from "@langwatch/trace-contract";

import { blobStoreResolving } from "../../__tests__/support/trace-blob-store.support.ts";
import type { TraceBlobStoreService } from "../../trace-blob-store.service.ts";
import { TraceIOExtractionService } from "../../trace-io-extraction.service.ts";

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
    cost: null,
    nonBilledCost: null,
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

const realIOService = TraceIOExtractionService.create(TraceCanonicalisationService.create());

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TraceOffloadResolutionService.resolveOffloadedTraces()", () => {
  describe("given a trace whose span has a reserved eventref pointer", () => {
    const fullOutput = "The full 50 KB output value that was offloaded via event_log";

    const spanWithRef = makeSpan({
      traceId: "trace-1",
      spanId: "span-1",
      spanAttributes: {
        "langwatch.output": "preview…",
        [`${EVENTREF_ATTR_PREFIX}langwatch.output`]: JSON.stringify({
          field: "langwatch.output",
          eventId: "evt-001",
        }),
      },
    });

    describe("when resolved", () => {
      let result: Awaited<ReturnType<typeof TraceOffloadResolutionService.resolveOffloadedTraces>>;

      beforeEach(async () => {
        const blobSvc = blobStoreResolving({ "langwatch.output": fullOutput });
        const logger = createMockLogger();

        result = await TraceOffloadResolutionService.resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanWithRef],
          blobStore: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });
      });

      it("resolved span attributes contain the full value, not the preview", () => {
        expect(result.resolvedSpans[0]!.spanAttributes["langwatch.output"]).toBe(fullOutput);
      });

      it("reserved eventref keys are stripped from the resolved span attributes", () => {
        const attrs = result.resolvedSpans[0]!.spanAttributes;
        const hasRef = Object.keys(attrs).some((k) => k.startsWith(EVENTREF_ATTR_PREFIX));
        expect(hasRef).toBe(false);
      });

      it("trace.output is recomputed from the full span value", () => {
        expect(result.recomputedOutput?.text).toBe(fullOutput);
      });

      it("anyResolved is true", () => {
        expect(result.anyResolved).toBe(true);
      });
    });
  });

  describe("given an eventref already decoded by attribute deserialization", () => {
    describe("when resolved", () => {
      it("restores the full value and removes the reserved attribute", async () => {
        const span = makeSpan({
          spanAttributes: {
            "langwatch.output": "preview",
            [`${EVENTREF_ATTR_PREFIX}langwatch.output`]: {
              field: "langwatch.output",
              eventId: "evt-decoded",
            },
          },
        });
        const result = await TraceOffloadResolutionService.resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [span],
          blobStore: blobStoreResolving({ "langwatch.output": "full output" }),
          ioExtractionService: realIOService,
          logger: createMockLogger(),
        });

        expect(result.resolvedSpans[0]!.spanAttributes).toMatchObject({
          "langwatch.output": "full output",
        });
        expect(
          result.resolvedSpans[0]!.spanAttributes[`${EVENTREF_ATTR_PREFIX}langwatch.output`],
        ).toBeUndefined();
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
        const blobSvc = blobStoreResolving({});
        const logger = createMockLogger();

        const result = await TraceOffloadResolutionService.resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanClean],
          blobStore: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        expect(result.resolvedSpans[0]).toBe(spanClean);
      });

      it("calls TraceBlobStoreService.getFromEventLog zero times", async () => {
        const blobSvc = blobStoreResolving({});
        const logger = createMockLogger();

        await TraceOffloadResolutionService.resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanClean],
          blobStore: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        expect(blobSvc.getFromEventLog).not.toHaveBeenCalled();
      });

      it("anyResolved is false", async () => {
        const blobSvc = blobStoreResolving({});
        const logger = createMockLogger();

        const result = await TraceOffloadResolutionService.resolveOffloadedTraces({
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

  describe("given a missing event_log row (TraceBlobStoreService.getFromEventLog throws BlobNotFoundError)", () => {
    const spanWithRef = makeSpan({
      traceId: "trace-1",
      spanId: "span-1",
      spanAttributes: {
        "langwatch.output": "preview…",
        [`${EVENTREF_ATTR_PREFIX}langwatch.output`]: JSON.stringify({
          field: "langwatch.output",
          eventId: "evt-001",
        }),
      },
    });

    function failingBlobStore(): TraceBlobStoreService {
      return blobStoreResolving({});
    }

    describe("when resolved", () => {
      it("does not throw — returns normally", async () => {
        const blobSvc = failingBlobStore();
        const logger = createMockLogger();

        await expect(
          TraceOffloadResolutionService.resolveOffloadedTraces({
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

        const result = await TraceOffloadResolutionService.resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanWithRef],
          blobStore: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        expect(result.resolvedSpans[0]!.spanAttributes["langwatch.output"]).toBe("preview…");
      });

      it("logs a warning at warn level", async () => {
        const blobSvc = failingBlobStore();
        const logger = createMockLogger();

        await TraceOffloadResolutionService.resolveOffloadedTraces({
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

        const result = await TraceOffloadResolutionService.resolveOffloadedTraces({
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
        [`${EVENTREF_ATTR_PREFIX}langwatch.output`]: "not-json{",
      },
    });

    describe("when resolved", () => {
      it("strips the reserved eventref key from returned span attributes", async () => {
        const blobSvc = blobStoreResolving({});
        const logger = createMockLogger();

        const result = await TraceOffloadResolutionService.resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanWithMalformedRef],
          blobStore: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        const attrs = result.resolvedSpans[0]!.spanAttributes;
        const hasReservedKey = Object.keys(attrs).some((k) => k.startsWith(EVENTREF_ATTR_PREFIX));
        expect(hasReservedKey).toBe(false);
      });
    });
  });
});
