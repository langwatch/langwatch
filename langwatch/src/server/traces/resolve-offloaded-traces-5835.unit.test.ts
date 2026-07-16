/**
 * TDD-red regression tests for issue #5835 AC9 (single-trace path).
 *
 * AC9: "Resolved content matches the fold's actual winning span on BOTH call
 * sites." resolveOffloadedTraces recomputes trace-level output at read time
 * via TraceIOExtractionService.extractLastOutput, which implements a
 * DIFFERENT winner-selection algorithm than the fold's own
 * TraceIOAccumulationService.accumulateIO:
 *
 *   - accumulateIO (via shouldOverrideOutput,
 *     trace-io-accumulation.service.ts:38-66): a ROOT span (parentSpanId ===
 *     null) ALWAYS beats a non-root span's output, regardless of end time.
 *     Tool/evaluation/guardrail/Claude-Code-utility spans are excluded from
 *     ever winning.
 *   - extractLastOutput (trace-io-extraction.service.ts:112-203): tries a
 *     "single span with valid output" fast path first; when MORE than one
 *     span has valid output it falls through to plain last-finishing-by-
 *     endTimeUnixMs across ALL eligible spans — no root-priority at all, and
 *     its shouldExcludeSpan only excludes evaluation/guardrail, NOT tool.
 *
 * These two tests drive the REAL resolveOffloadedTraces end-to-end (through
 * the real eventref-resolution machinery and the REAL
 * TraceIOExtractionService.extractLastOutput — nothing here is mocked away)
 * to prove the divergence at the read-time recompute, not just at the
 * algorithm level.
 *
 * Do NOT fix the bug here — these tests must FAIL against the current
 * TraceIOExtractionService.extractLastOutput implementation. The bulk-path
 * sibling lives in resolve-offloaded-traces-batch-5835.unit.test.ts.
 *
 * Conventions matched from resolve-offloaded-traces.unit.test.ts /
 * resolve-offloaded-traces-4888.unit.test.ts:
 *   - vitest, vi.mock("langwatch", ...) tracer passthrough
 *   - BDD nested describe (given / when), action-based it() names, no "should"
 *   - makeSpan / createMockLogger / fakeBlobStore helpers local to this file
 *   - real TraceIOExtractionService instance (ioExtractionService is never
 *     mocked — that would hide the exact bug this test proves)
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
// Helpers (matches resolve-offloaded-traces.unit.test.ts conventions)
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
 * of field -> fullValue, matching the sibling unit test files' convention.
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

// Real service — NOT mocked. The bug lives inside extractLastOutput's own
// winner-selection logic, so mocking it away would prove nothing.
const realIOService = new TraceIOExtractionService();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("resolveOffloadedTraces() — #5835 AC9: recomputed output matches the fold's winner", () => {
  describe("given a root span whose offloaded output is the fold's winner, and a later-ending non-root child with a plain short output", () => {
    // Mirrors the traceSummaryIO.test.ts:63-103 "does not override root span
    // output" fixture (root ends at 2000, a child parented to it ends later
    // at 2500). The fold (TraceIOAccumulationService.accumulateIO /
    // shouldOverrideOutput) keeps the ROOT's output unconditionally — a root
    // always beats a non-root child regardless of end time. extractLastOutput
    // does not implement that rule: with 2 spans carrying valid output, its
    // single-node fast path doesn't fire, so it falls through to plain
    // last-finishing-by-endTimeUnixMs and picks the child instead.
    const ROOT_FULL_OUTPUT = "ROOT-" + "a".repeat(70_000); // >64KB, distinctive

    const rootSpan = makeSpan({
      traceId: "trace-5835-priority",
      spanId: "root-1",
      parentSpanId: null,
      startTimeUnixMs: 0,
      endTimeUnixMs: 2000,
      spanAttributes: {
        "langwatch.output": "ROOT-preview…",
        [`${EVENTREF_ATTR_PREFIX}langwatch.output`]: JSON.stringify({
          field: "langwatch.output",
          eventId: "evt-root-output",
        }),
      },
    });

    const childSpan = makeSpan({
      traceId: "trace-5835-priority",
      spanId: "child-1",
      parentSpanId: "root-1",
      startTimeUnixMs: 500,
      endTimeUnixMs: 2500,
      spanAttributes: {
        "langwatch.output": "child output",
      },
    });

    describe("when the trace is read through resolveOffloadedTraces", () => {
      /** @scenario Resolved content matches the fold's actual winning span, not a different one */
      it("recomputes the trace output as the root span's full resolved content, not the later-ending child's", async () => {
        const blobStore = fakeBlobStore({
          "langwatch.output": ROOT_FULL_OUTPUT,
        });
        const logger = createMockLogger();

        const result = await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [rootSpan, childSpan],
          blobStore,
          ioExtractionService: realIOService,
          logger,
        });

        expect(result.recomputedOutput?.text).toBe(ROOT_FULL_OUTPUT);
      });
    });
  });

  describe("given a root-position tool-type span carrying offloaded output, and a genuine conversational span with plain output", () => {
    // Supplementary case: the EXCLUSION-set dimension, distinct from the
    // priority dimension above. accumulateIO never lets a tool-type span
    // (spanType === "tool") win the trace's headline output — it returns
    // early for tool spans before any output-comparison logic runs.
    // TraceIOExtractionService.shouldExcludeSpan only excludes
    // evaluation/guardrail, so a tool span is a fully eligible candidate for
    // extractLastOutput today, and — arranged so it ends later than the
    // conversational span — wins the last-finishing fallback.
    const TOOL_FULL_OUTPUT = "TOOL-" + "a".repeat(70_000); // >64KB, distinctive
    const CONVERSATIONAL_OUTPUT = "the assistant's real reply to the user";

    const toolSpan = makeSpan({
      traceId: "trace-5835-exclusion",
      spanId: "tool-1",
      parentSpanId: null,
      startTimeUnixMs: 0,
      endTimeUnixMs: 2000,
      spanAttributes: {
        "langwatch.span.type": "tool",
        "langwatch.output": "TOOL-preview…",
        [`${EVENTREF_ATTR_PREFIX}langwatch.output`]: JSON.stringify({
          field: "langwatch.output",
          eventId: "evt-tool-output",
        }),
      },
    });

    const conversationalSpan = makeSpan({
      traceId: "trace-5835-exclusion",
      spanId: "conversational-1",
      parentSpanId: null,
      startTimeUnixMs: 500,
      endTimeUnixMs: 1000,
      spanAttributes: {
        "langwatch.output": CONVERSATIONAL_OUTPUT,
      },
    });

    describe("when the trace is read through resolveOffloadedTraces", () => {
      /** @scenario Resolved content excludes tool and Claude-Code-utility spans from winning */
      it("recomputes the trace output as the conversational span's content, not the tool span's", async () => {
        const blobStore = fakeBlobStore({
          "langwatch.output": TOOL_FULL_OUTPUT,
        });
        const logger = createMockLogger();

        const result = await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [toolSpan, conversationalSpan],
          blobStore,
          ioExtractionService: realIOService,
          logger,
        });

        expect(result.recomputedOutput?.text).toBe(CONVERSATIONAL_OUTPUT);
      });
    });
  });
});
