/**
 * Unit tests proving that the trace-list read path (TraceListService.getList)
 * restores each row's FULL trace-level input/output from event_log — instead of
 * the 64 KB write-time preview stored in `trace_summaries` — ONLY when the
 * caller opts in via `resolveFullIO` (the drawer's Conversation tab, #5835 AC2).
 *
 * The single most important test here is the AC5 regression guard: with
 * `resolveFullIO` omitted (the grid's real call shape), the service must issue
 * ZERO span reads and ZERO event_log reads — byte-identical to the pre-#5835
 * preview-only behaviour the grid depends on.
 *
 * They also pin:
 *   - the load-bearing ordering: resolution happens BEFORE the visibility gate,
 *     so a pre-cutoff row is teaser-redacted on the RESOLVED value and never
 *     leaks it past the visibility window (#5835 AC10, list half); and
 *   - the best-effort "content may be incomplete" signal (inputTruncated /
 *     outputTruncated) fires only when a field's eventref could not be resolved
 *     (#5835 AC4, list half).
 *
 * Structural template: trace-summary-offload-resolution.unit.test.ts (same
 * layer — a *Service with optional blob-resolution deps, mocked
 * BlobStore/repository — adapted for a LIST of rows instead of one).
 *
 * BDD structure: given/when nested describes, action-based it() names.
 */

import { describe, expect, it, vi } from "vitest";

// Passthrough mock for the langwatch tracer used by TraceIOExtractionService.
vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: (
      _name: string,
      _opts: unknown,
      fn: (span: {
        setAttribute: () => void;
        setAttributes: () => void;
      }) => unknown,
    ) => fn({ setAttribute: () => {}, setAttributes: () => {} }),
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

import type { EvaluationRunService } from "~/server/app-layer/evaluations/evaluation-run.service";
import type { TopicService } from "~/server/app-layer/topics/topic.service";
import type { BlobStore } from "~/server/app-layer/traces/blob-store.service";
import { BlobNotFoundError } from "~/server/app-layer/traces/blob-store.service";
import { EVENTREF_ATTR_PREFIX } from "~/server/app-layer/traces/lean-for-projection";
import type { TraceListRepository } from "~/server/app-layer/traces/repositories/trace-list.repository";
import { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import {
  SPAN_READ_CONCURRENCY,
  type TraceListBlobResolutionDeps,
  TraceListService,
} from "~/server/app-layer/traces/trace-list.service";
import type { TraceSpansReader } from "~/server/app-layer/traces/trace-summary.service";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import {
  TEASER_ELLIPSIS,
  TEASER_MAX_CHARS,
  teaserOf,
} from "~/server/app-layer/traces/visibility-window.service";
import {
  type NormalizedSpan,
  NormalizedSpanKind,
  NormalizedStatusCode,
} from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

// Full values exceed the 64 KB IO preview budget (IO_PREVIEW_BYTES) so they are
// exactly the case the preview truncates. Distinctive prefixes let the teaser
// assertions tell "teased the RESOLVED full value" apart from "teased the
// stored preview".
const FULL_INPUT = `FULL-INPUT-CONTENT-${"a".repeat(70 * 1024)}`;
const FULL_OUTPUT = `FULL-OUTPUT-CONTENT-${"b".repeat(70 * 1024)}`;
const PREVIEW_INPUT = `PREVIEW-INPUT-${"p".repeat(300)}`;
const PREVIEW_OUTPUT = `PREVIEW-OUTPUT-${"q".repeat(300)}`;

function makeNormalizedSpan(
  overrides: Partial<NormalizedSpan> & {
    spanAttributes?: Record<string, string>;
  } = {},
): NormalizedSpan {
  return {
    id: "span-root",
    traceId: "trace-1",
    spanId: "span-root",
    tenantId: "proj-1",
    parentSpanId: null,
    parentTraceId: null,
    parentIsRemote: null,
    sampled: true,
    startTimeUnixMs: 1000,
    endTimeUnixMs: 2000,
    durationMs: 1000,
    name: "root-span",
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

/**
 * A root span for `traceId` whose langwatch.input / langwatch.output attributes
 * were offloaded: each carries a bounded preview plus a
 * `langwatch.reserved.eventref.*` pointer into event_log. Being the (only) root
 * span, it wins the fold's trace-level input AND output selection.
 */
function makeOffloadedRootSpan(traceId: string): NormalizedSpan {
  return makeNormalizedSpan({
    traceId,
    spanId: `${traceId}-root`,
    spanAttributes: {
      "langwatch.input": PREVIEW_INPUT,
      "langwatch.output": PREVIEW_OUTPUT,
      [`${EVENTREF_ATTR_PREFIX}langwatch.input`]: JSON.stringify({
        field: "langwatch.input",
        eventId: "evt-in",
      }),
      [`${EVENTREF_ATTR_PREFIX}langwatch.output`]: JSON.stringify({
        field: "langwatch.output",
        eventId: "evt-out",
      }),
    },
  });
}

/** A plain root span for `traceId` with no offloaded eventref pointers. */
function makePlainRootSpan(traceId: string): NormalizedSpan {
  return makeNormalizedSpan({
    traceId,
    spanId: `${traceId}-root`,
    spanAttributes: { "langwatch.output": "PLAIN-SPAN-OUTPUT" },
  });
}

/** A complete-enough TraceSummaryData row for `mapToTraceListItem`. */
function makeRow(overrides: Partial<TraceSummaryData> = {}): TraceSummaryData {
  return {
    traceId: "trace-1",
    occurredAt: Date.now(),
    computedInput: PREVIEW_INPUT,
    computedOutput: PREVIEW_OUTPUT,
    errorMessage: null,
    spanCount: 1,
    totalDurationMs: 100,
    totalCost: 0,
    nonBilledCost: null,
    totalPromptTokenCount: null,
    totalCompletionTokenCount: null,
    models: [],
    lastUsedPromptId: null,
    lastUsedPromptVersionNumber: null,
    sizeBytes: 0,
    tokensEstimated: false,
    timeToFirstTokenMs: null,
    traceName: "trace-1",
    rootSpanType: null,
    containsErrorStatus: false,
    blockedByGuardrail: false,
    attributes: {},
    ...overrides,
  } as unknown as TraceSummaryData;
}

function makeRepository(rows: TraceSummaryData[]): TraceListRepository {
  return {
    findAll: vi.fn(async () => ({ rows, totalHits: rows.length })),
  } as unknown as TraceListRepository;
}

function makeEvaluationRunService(): EvaluationRunService {
  return {
    findSummariesByTraceIds: vi.fn(async () => ({})),
  } as unknown as EvaluationRunService;
}

function makeTopicService(): TopicService {
  return {} as unknown as TopicService;
}

function makeSpansReader(
  spansByTrace: Record<string, NormalizedSpan[]>,
): TraceSpansReader {
  return {
    getNormalizedSpansByTraceId: vi.fn(
      async ({ traceId }: { traceId: string }) => spansByTrace[traceId] ?? [],
    ),
  };
}

function makeBlobStore(resolvedValues: Record<string, string>): BlobStore {
  return {
    getFromEventLog: vi.fn(async ({ field }: { field: string }) => {
      if (field in resolvedValues) return resolvedValues[field]!;
      throw new BlobNotFoundError("evt-test", field, "proj-1");
    }),
    putSpool: vi.fn(),
    getSpool: vi.fn(),
    deleteSpool: vi.fn(),
  } as unknown as BlobStore;
}

function makeDeps(
  spansByTrace: Record<string, NormalizedSpan[]>,
  resolvedValues: Record<string, string>,
): TraceListBlobResolutionDeps {
  return {
    blobStore: makeBlobStore(resolvedValues),
    ioExtractionService: new TraceIOExtractionService(),
    spansReader: makeSpansReader(spansByTrace),
  };
}

function makeService(
  rows: TraceSummaryData[],
  deps?: TraceListBlobResolutionDeps,
): TraceListService {
  return new TraceListService(
    makeRepository(rows),
    makeEvaluationRunService(),
    makeTopicService(),
    deps,
  );
}

const BASE_LIST_PARAMS = {
  tenantId: "proj-1",
  timeRange: { from: 0, to: Date.now() + DAY_MS },
  sort: { columnId: "time", direction: "asc" as const },
  page: 1,
  pageSize: 50,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TraceListService read-time offload resolution (#5835)", () => {
  describe("given resolveFullIO is true and one row carries a resolvable IO eventref", () => {
    describe("when getList is called with blob-resolution deps and no visibility gate", () => {
      /** @scenario Conversation tab resolves full turn text beyond the 64KB preview */
      it("resolves the offloaded row's full output and leaves the plain row unchanged", async () => {
        const service = makeService(
          [
            makeRow({ traceId: "trace-A" }),
            makeRow({
              traceId: "trace-B",
              computedInput: "ROW-B-INPUT",
              computedOutput: "ROW-B-OUTPUT",
            }),
          ],
          makeDeps(
            {
              "trace-A": [makeOffloadedRootSpan("trace-A")],
              "trace-B": [makePlainRootSpan("trace-B")],
            },
            { "langwatch.input": FULL_INPUT, "langwatch.output": FULL_OUTPUT },
          ),
        );

        const page = await service.getList({
          ...BASE_LIST_PARAMS,
          resolveFullIO: true,
        });

        // Offloaded row: full resolved value, not the stored preview.
        expect(page.items[0]!.output).toBe(FULL_OUTPUT);
        expect(page.items[0]!.output).not.toBe(PREVIEW_OUTPUT);
        expect(page.items[0]!.input).toBe(FULL_INPUT);
        // Resolved successfully → never flagged incomplete.
        expect(page.items[0]!.inputTruncated).toBeFalsy();
        expect(page.items[0]!.outputTruncated).toBeFalsy();

        // Plain row (no eventref) is untouched.
        expect(page.items[1]!.output).toBe("ROW-B-OUTPUT");
        expect(page.items[1]!.input).toBe("ROW-B-INPUT");
        expect(page.items[1]!.inputTruncated).toBeFalsy();
        expect(page.items[1]!.outputTruncated).toBeFalsy();
      });
    });

    describe("when the offloaded row occurred before the visibility cutoff", () => {
      it("teases the resolved full content, never the stored preview and never the full value", async () => {
        const deps = makeDeps(
          { "trace-A": [makeOffloadedRootSpan("trace-A")] },
          { "langwatch.input": FULL_INPUT, "langwatch.output": FULL_OUTPUT },
        );
        const service = makeService(
          [makeRow({ traceId: "trace-A", occurredAt: Date.now() - 30 * DAY_MS })],
          deps,
        );

        const page = await service.getList({
          ...BASE_LIST_PARAMS,
          resolveFullIO: true,
          visibilityCutoffMs: Date.now() - 14 * DAY_MS,
        });

        // The teaser is derived from the RESOLVED full value (resolution ran
        // BEFORE the gate), then capped by the visibility window — proving
        // resolution neither bypasses the gate nor runs after it. The
        // preview-teaser discriminator is what fails if resolve-before-gate
        // regresses (the gate would then tease the stored preview instead).
        expect(page.items[0]!.output).toBe(teaserOf(FULL_OUTPUT));
        expect(page.items[0]!.input).toBe(teaserOf(FULL_INPUT));
        expect(page.items[0]!.output).not.toBe(FULL_OUTPUT);
        expect(page.items[0]!.output).not.toBe(teaserOf(PREVIEW_OUTPUT));
        expect(page.items[0]!.output).toHaveLength(
          TEASER_MAX_CHARS + TEASER_ELLIPSIS.length,
        );
      });
    });
  });

  describe("given resolveFullIO is omitted (the grid's real call shape)", () => {
    describe("when getList is called with blob-resolution deps present", () => {
      /** @scenario The trace grid continues to issue zero event_log reads */
      it("issues zero span reads and zero event_log reads (AC5 regression guard)", async () => {
        const deps = makeDeps(
          { "trace-A": [makeOffloadedRootSpan("trace-A")] },
          { "langwatch.input": FULL_INPUT, "langwatch.output": FULL_OUTPUT },
        );
        const service = makeService([makeRow({ traceId: "trace-A" })], deps);

        const page = await service.getList({ ...BASE_LIST_PARAMS });

        // The single most important invariant of this task: the preview-only
        // grid path must never touch the resolution deps.
        expect(deps.spansReader.getNormalizedSpansByTraceId).not.toHaveBeenCalled();
        expect(deps.blobStore.getFromEventLog).not.toHaveBeenCalled();
        // ...and the row still carries its stored preview, byte-identical to
        // pre-#5835 behaviour.
        expect(page.items[0]!.output).toBe(PREVIEW_OUTPUT);
        expect(page.items[0]!.input).toBe(PREVIEW_INPUT);
      });
    });
  });

  describe("given resolveFullIO is true over a page far larger than the span-read concurrency bound", () => {
    describe("when getList fans out the per-row span reads", () => {
      // Implementation-level guard (no bound BDD scenario): the read-cost
      // contract is covered by the Track 3 "Read cost is bounded by offloaded
      // span/field count" scenario; this pins the concurrency ceiling.
      it("never exceeds SPAN_READ_CONCURRENCY span reads in flight at once", async () => {
        const rowCount = SPAN_READ_CONCURRENCY * 3;
        const rows = Array.from({ length: rowCount }, (_, i) =>
          makeRow({ traceId: `trace-${i}` }),
        );
        const spansByTrace: Record<string, NormalizedSpan[]> = {};
        for (let i = 0; i < rowCount; i++) {
          spansByTrace[`trace-${i}`] = [makePlainRootSpan(`trace-${i}`)];
        }

        let inFlight = 0;
        let maxInFlight = 0;
        const spansReader: TraceSpansReader = {
          getNormalizedSpansByTraceId: vi.fn(
            async ({ traceId }: { traceId: string }) => {
              inFlight++;
              maxInFlight = Math.max(maxInFlight, inFlight);
              // Yield so sibling reads overlap — an unbounded Promise.all would
              // start all `rowCount` reads at once, driving maxInFlight to
              // rowCount (3× the bound) and failing the assertion below.
              await new Promise((resolve) => setTimeout(resolve, 1));
              inFlight--;
              return spansByTrace[traceId] ?? [];
            },
          ),
        };
        const deps: TraceListBlobResolutionDeps = {
          blobStore: makeBlobStore({}),
          ioExtractionService: new TraceIOExtractionService(),
          spansReader,
        };

        const page = await makeService(rows, deps).getList({
          ...BASE_LIST_PARAMS,
          pageSize: rowCount,
          resolveFullIO: true,
        });

        expect(page.items).toHaveLength(rowCount);
        // Row order is preserved despite the unordered bounded execution (the
        // index-based writes back into spansPerTrace) — assert the sequence,
        // don't just claim it.
        expect(page.items.map((item) => item.traceId)).toEqual(
          rows.map((row) => row.traceId),
        );
        // Every row's spans were read exactly once...
        expect(spansReader.getNormalizedSpansByTraceId).toHaveBeenCalledTimes(
          rowCount,
        );
        // ...but never more than the bound were ever in flight at one instant.
        expect(maxInFlight).toBeGreaterThan(0);
        expect(maxInFlight).toBeLessThanOrEqual(SPAN_READ_CONCURRENCY);
      });
    });
  });

  describe("given resolveFullIO is true and a row's eventref points at a missing event_log row", () => {
    describe("when getList is called with blob-resolution deps", () => {
      /** @scenario Conversation tab shows an incomplete-content indicator when resolution fails */
      it("keeps the preview and flags the fields as truncated without throwing", async () => {
        const service = makeService(
          [makeRow({ traceId: "trace-A" })],
          // Empty blob store → getFromEventLog always throws BlobNotFoundError.
          makeDeps({ "trace-A": [makeOffloadedRootSpan("trace-A")] }, {}),
        );

        const page = await service.getList({
          ...BASE_LIST_PARAMS,
          resolveFullIO: true,
        });

        // Documented error policy: a stale/missing ref never breaks the read —
        // the stored preview stays in place.
        expect(page.items[0]!.input).toBe(PREVIEW_INPUT);
        expect(page.items[0]!.output).toBe(PREVIEW_OUTPUT);
        // ...but the fields are marked so the UI can warn content may be incomplete.
        expect(page.items[0]!.inputTruncated).toBe(true);
        expect(page.items[0]!.outputTruncated).toBe(true);
      });
    });
  });
});
