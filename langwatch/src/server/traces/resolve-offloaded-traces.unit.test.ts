/**
 * Unit tests for the resolveOffloadedTraces helper — per-trace span-level
 * eventref resolution and TraceIO recompute (read-resolution half of ADR-022).
 * Each test covers one assertion.
 *
 * BDD structure: given/when nested describes, action-based it() names.
 */
import { describe, expect, it, vi } from "vitest";

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

import type { BlobStore } from "~/server/app-layer/traces/blob-store.service";
import { BlobNotFoundError } from "~/server/app-layer/traces/blob-store.service";
import { EVENTREF_ATTR_PREFIX } from "~/server/app-layer/traces/lean-for-projection";
import { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import {
  type NormalizedSpan,
  NormalizedSpanKind,
  NormalizedStatusCode,
} from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";
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

/**
 * Creates a fake BlobStore whose getFromEventLog returns a pre-configured map
 * of field → fullValue for the given eventId / aggregateId combination.
 */
function fakeBlobStore(resolvedValues: Record<string, string>): BlobStore {
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
        if (field in resolvedValues) {
          return resolvedValues[field]!;
        }
        throw new BlobNotFoundError("evt-test", field, "proj-1");
      },
    ),
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
    const fullOutput =
      "The full 50 KB output value that was offloaded via event_log";

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
        const getFromEventLogSpy = blobSvc.getFromEventLog as ReturnType<
          typeof vi.fn
        >;
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
        [`${EVENTREF_ATTR_PREFIX}langwatch.output`]: JSON.stringify({
          field: "langwatch.output",
          eventId: "evt-001",
        }),
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
        [`${EVENTREF_ATTR_PREFIX}langwatch.output`]: "not-json{",
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

      // #5835 AC4b gap: a value that fails JSON.parse entirely (as opposed to
      // parsing but missing eventId) must not be a SILENT drop — it has to
      // surface the same way missingEventIdKeys does, via a warn log the
      // caller can act on. Before this fix, parseSpanEventRefs's catch block
      // discarded the key with no record of it ever existing, so this path
      // could never be logged by any caller.
      it("does not throw — returns normally", async () => {
        const blobSvc = fakeBlobStore({});
        const logger = createMockLogger();

        await expect(
          resolveOffloadedTraces({
            projectId: "proj-1",
            normalizedSpans: [spanWithMalformedRef],
            blobStore: blobSvc,
            ioExtractionService: realIOService,
            logger,
          }),
        ).resolves.not.toThrow();
      });

      it("keeps the preview value intact in the span attributes", async () => {
        const blobSvc = fakeBlobStore({});
        const logger = createMockLogger();

        const result = await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanWithMalformedRef],
          blobStore: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        expect(
          result.resolvedSpans[0]!.spanAttributes["langwatch.output"],
        ).toBe("preview…");
      });

      it("logs a warning at warn level identifying the malformed attrKey", async () => {
        const blobSvc = fakeBlobStore({});
        const logger = createMockLogger();

        await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanWithMalformedRef],
          blobStore: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        expect(logger.warn).toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ attrKey: "langwatch.output" }),
          expect.any(String),
        );
      });
    });
  });
});

// ---------------------------------------------------------------------------
// #5835 AC7: read count is bounded by offloaded fields, not total span count.
// ---------------------------------------------------------------------------

describe("resolveOffloadedTraces() — #5835 AC7: read count is bounded by offloaded fields, not total span count", () => {
  describe("given a trace whose spans carry zero langwatch.reserved.eventref.* attributes", () => {
    const plainRoot = makeSpan({
      traceId: "trace-ac7-no-offload",
      spanId: "root-1",
      parentSpanId: null,
      spanAttributes: {
        "langwatch.output": "a normal, non-offloaded root output",
      },
    });
    const plainChild = makeSpan({
      traceId: "trace-ac7-no-offload",
      spanId: "child-1",
      parentSpanId: "root-1",
      spanAttributes: {
        "langwatch.output": "a normal, non-offloaded child output",
      },
    });
    const normalizedSpans = [plainRoot, plainChild];

    describe("when resolved", () => {
      it("calls BlobStore.getFromEventLog zero times", async () => {
        const blobSvc = fakeBlobStore({});
        const getFromEventLogSpy = blobSvc.getFromEventLog as ReturnType<
          typeof vi.fn
        >;
        const logger = createMockLogger();

        await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans,
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
          normalizedSpans,
          blobStore: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        expect(result.anyResolved).toBe(false);
      });

      it("resolvedSpans is the exact same array reference as the input", async () => {
        const blobSvc = fakeBlobStore({});
        const logger = createMockLogger();

        const result = await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans,
          blobStore: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        // The fast path (anyHasRefs === false) returns `normalizedSpans`
        // itself, not a copy — proving zero per-span mapping work happens.
        expect(result.resolvedSpans).toBe(normalizedSpans);
      });
    });
  });

  describe("given N spans where two carry offloaded fields — a root winner and an excluded tool span — plus one span with no eventref at all", () => {
    // toolSpan deliberately does NOT win the trace's headline output:
    // spanType "tool" makes accumulateIO (trace-io-accumulation.service.ts:
    // 245-261, reached via recomputeTraceIO) return early for it, before any
    // output-comparison logic runs — the same exclusion rule the #5835 AC9
    // fixture in resolve-offloaded-traces-5835.unit.test.ts exercises. It is
    // also given the LATEST endTimeUnixMs of all three spans, so a naive
    // last-finishing-wins read would (wrongly) prefer it.
    //
    // This proves resolveOffloadedTraces's per-span Promise.allSettled loop
    // (resolve-offloaded-traces.ts, ~lines 139-238) resolves every
    // eventref-bearing FIELD up front, for every span that carries one —
    // not just the fields belonging to whichever span recomputeTraceIO later
    // picks as the winner.
    const rootSpan = makeSpan({
      traceId: "trace-ac7-bounded",
      spanId: "root-1",
      parentSpanId: null,
      startTimeUnixMs: 0,
      endTimeUnixMs: 2000,
      spanAttributes: {
        "langwatch.input": "ROOT-input-preview…",
        "langwatch.output": "ROOT-output-preview…",
        [`${EVENTREF_ATTR_PREFIX}langwatch.input`]: JSON.stringify({
          field: "langwatch.input",
          eventId: "evt-root-input",
        }),
        [`${EVENTREF_ATTR_PREFIX}langwatch.output`]: JSON.stringify({
          field: "langwatch.output",
          eventId: "evt-root-output",
        }),
      },
    }); // 2 eventref-bearing fields

    const toolSpan = makeSpan({
      traceId: "trace-ac7-bounded",
      spanId: "tool-1",
      parentSpanId: null,
      startTimeUnixMs: 0,
      endTimeUnixMs: 5000, // latest-ending of all three — would win a naive last-finishing comparison
      spanAttributes: {
        "langwatch.span.type": "tool",
        "langwatch.output": "TOOL-output-preview…",
        [`${EVENTREF_ATTR_PREFIX}langwatch.output`]: JSON.stringify({
          field: "langwatch.output",
          eventId: "evt-tool-output",
        }),
      },
    }); // 1 eventref-bearing field

    const cleanChild = makeSpan({
      traceId: "trace-ac7-bounded",
      spanId: "clean-1",
      parentSpanId: "root-1",
      startTimeUnixMs: 500,
      endTimeUnixMs: 800,
      spanAttributes: {
        "langwatch.output": "a plain, never-offloaded child output",
      },
    }); // 0 eventref-bearing fields — proves untouched spans are skipped

    // F = total langwatch.reserved.eventref.* entries across the fixture:
    // 2 (rootSpan) + 1 (toolSpan) + 0 (cleanChild) = 3.
    const TOTAL_EVENTREF_FIELDS = 3;

    describe("when resolved", () => {
      it("calls BlobStore.getFromEventLog exactly F times — once per offloaded field, not once per span and not only for the winner", async () => {
        const blobSvc = fakeBlobStore({
          "langwatch.input": "ROOT-full-input",
          "langwatch.output": "resolved-output",
        });
        const getFromEventLogSpy = blobSvc.getFromEventLog as ReturnType<
          typeof vi.fn
        >;
        const logger = createMockLogger();

        await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [rootSpan, toolSpan, cleanChild],
          blobStore: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        expect(getFromEventLogSpy).toHaveBeenCalledTimes(
          TOTAL_EVENTREF_FIELDS,
        );
      });
    });
  });
});
