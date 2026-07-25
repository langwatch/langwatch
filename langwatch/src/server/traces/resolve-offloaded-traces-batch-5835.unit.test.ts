/**
 * Regression test for issue #5835 AC9 (bulk path).
 *
 * See resolve-offloaded-traces-5835.unit.test.ts for the full rationale — the
 * SAME winner-selection contract applies here since resolveOffloadedTracesBatch
 * recomputes trace-level IO per trace via the fold's own algorithm (Phase 3):
 * `recomputeTraceIO` over `TraceIOAccumulationService`, NOT the old
 * `TraceIOExtractionService.extractLastOutput` read-time path.
 *
 * This file drives the REAL resolveOffloadedTracesBatch end-to-end with a
 * single-trace batch of one, using the identical root+later-ending-child
 * fixture as the single-trace test, to prove the recompute matches the fold's
 * actual winning span on the bulk call site too (AC9: "matches the fold's
 * actual winning span on BOTH call sites") and guards against a regression back
 * to extractLastOutput.
 *
 * Conventions matched from resolve-offloaded-traces-batch.unit.test.ts:
 *   - vitest, vi.mock("langwatch", ...) tracer passthrough
 *   - BDD nested describe (given / when), action-based it() names, no "should"
 *   - makeSpan / createMockLogger helpers local to this file
 *   - fakeBlobStore keyed by field name, matching resolve-offloaded-traces.unit.test.ts
 *     / resolve-offloaded-traces-4888.unit.test.ts (the batch file's own
 *     sibling tests use ad hoc per-describe BlobStore mocks for their AC6/AC7
 *     concerns; a field-keyed fakeBlobStore is the right shape here since
 *     this test only needs one specific field resolved to one specific value)
 *   - real TraceIOExtractionService instance (ioExtractionService is never
 *     mocked — that would hide the exact bug this test proves)
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: (
      _name: string,
      _opts: unknown,
      fn: (span: { setAttributes: () => void }) => unknown,
    ) => fn({ setAttributes: () => undefined }),
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
import { resolveOffloadedTracesBatch } from "./resolve-offloaded-traces-batch";

// ---------------------------------------------------------------------------
// Helpers (matches resolve-offloaded-traces-batch.unit.test.ts conventions)
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
    // Required (nullable) since #5012 wired per-span cost into NormalizedSpan.
    // Blob resolution is cost-agnostic, so null is the honest fixture value.
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
 * of field -> fullValue (keyed by field name only, matching
 * resolve-offloaded-traces.unit.test.ts's convention).
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

describe("resolveOffloadedTracesBatch() — #5835 AC9: recomputed output matches the fold's winner", () => {
  describe("given a single-trace batch containing a root span whose offloaded output is the fold's winner, and a later-ending non-root child with a plain short output", () => {
    // Identical fixture to resolve-offloaded-traces-5835.unit.test.ts, adapted
    // to the batch signature's spansPerTrace: NormalizedSpan[][] shape (a
    // batch of exactly one trace). Root ends at 2000; a child parented to it
    // ends later at 2500, mirroring the traceSummaryIO.test.ts:63-103
    // "does not override root span output" fixture.
    const ROOT_FULL_OUTPUT = "ROOT-" + "a".repeat(70_000); // >64KB, distinctive

    const rootSpan = makeSpan({
      traceId: "trace-5835-batch-priority",
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
      traceId: "trace-5835-batch-priority",
      spanId: "child-1",
      parentSpanId: "root-1",
      startTimeUnixMs: 500,
      endTimeUnixMs: 2500,
      spanAttributes: {
        "langwatch.output": "child output",
      },
    });

    describe("when the batch is resolved through resolveOffloadedTracesBatch", () => {
      it("recomputes the trace output as the root span's full resolved content, not the later-ending child's", async () => {
        const blobStore = fakeBlobStore({
          "langwatch.output": ROOT_FULL_OUTPUT,
        });
        const logger = createMockLogger();

        const results = await resolveOffloadedTracesBatch({
          projectId: "proj-1",
          spansPerTrace: [[rootSpan, childSpan]],
          blobStore,
          ioExtractionService: realIOService,
          logger,
        });

        expect(results[0]!.recomputedOutput?.text).toBe(ROOT_FULL_OUTPUT);
      });
    });
  });
});
