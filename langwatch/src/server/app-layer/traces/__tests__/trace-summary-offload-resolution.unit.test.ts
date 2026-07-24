/**
 * Unit tests proving that the Summary-panel read path
 * (TraceSummaryService.getByTraceId) restores the FULL trace-level
 * input/output from event_log before returning — instead of the 64 KB
 * write-time preview stored in `trace_summaries` — when ADR-022 blob-resolution
 * deps are wired (#5835 AC1).
 *
 * They also pin the load-bearing ordering: resolution happens BEFORE the
 * visibility gate, so a pre-cutoff trace is teaser-redacted on the RESOLVED
 * value and never leaks it past the visibility window (#5835 AC10, summary
 * half); and the best-effort "content may be incomplete" signal
 * (inputTruncated / outputTruncated) fires only when a field's eventref could
 * not be resolved (partial AC4, service layer).
 *
 * Structural template: span-storage-v2-offload-resolution.unit.test.ts (same
 * layer — a *Service with optional blob-resolution deps, mocked
 * BlobStore/repository).
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

import type { BlobStore } from "~/server/app-layer/traces/blob-store.service";
import { BlobNotFoundError } from "~/server/app-layer/traces/blob-store.service";
import { EVENTREF_ATTR_PREFIX } from "~/server/app-layer/traces/lean-for-projection";
import type { TraceSummaryRepository } from "~/server/app-layer/traces/repositories/trace-summary.repository";
import { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import {
  type TraceSpansReader,
  type TraceSummaryBlobResolutionDeps,
  TraceSummaryService,
} from "~/server/app-layer/traces/trace-summary.service";
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
// assertion below tell "teased the RESOLVED full value" apart from "teased the
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
 * A single root span whose langwatch.input / langwatch.output attributes were
 * offloaded: each carries a bounded preview plus a `langwatch.reserved.eventref.*`
 * pointer into event_log. Being the (only) root span, it wins the fold's
 * trace-level input AND output selection.
 */
function makeOffloadedRootSpan(): NormalizedSpan {
  return makeNormalizedSpan({
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

function makeSummary(overrides: Partial<TraceSummaryData> = {}): TraceSummaryData {
  return {
    traceId: "trace-1",
    occurredAt: Date.now(),
    computedInput: PREVIEW_INPUT,
    computedOutput: PREVIEW_OUTPUT,
    errorMessage: null,
    spanCount: 1,
    totalDurationMs: 100,
    attributes: {},
    ...overrides,
  } as unknown as TraceSummaryData;
}

function makeRepository(summary: TraceSummaryData): TraceSummaryRepository {
  return {
    findByTraceId: vi.fn().mockResolvedValue(summary),
    upsert: vi.fn(),
  } as unknown as TraceSummaryRepository;
}

function makeSpansReader(spans: NormalizedSpan[]): TraceSpansReader {
  return {
    getNormalizedSpansByTraceId: vi.fn(async () => spans),
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
  spans: NormalizedSpan[],
  resolvedValues: Record<string, string>,
): TraceSummaryBlobResolutionDeps {
  return {
    blobStore: makeBlobStore(resolvedValues),
    ioExtractionService: new TraceIOExtractionService(),
    spansReader: makeSpansReader(spans),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TraceSummaryService read-time offload resolution (#5835)", () => {
  describe("given a trace whose winning span carries a resolvable IO eventref", () => {
    describe("when getByTraceId is called with blob-resolution deps and no visibility gate", () => {
      /** @scenario Summary panel resolves full input/output beyond the 64KB preview */
      it("returns the full resolved input and output, not the stored preview", async () => {
        const service = new TraceSummaryService(
          makeRepository(makeSummary()),
          makeDeps([makeOffloadedRootSpan()], {
            "langwatch.input": FULL_INPUT,
            "langwatch.output": FULL_OUTPUT,
          }),
        );

        const summary = await service.getByTraceId("proj-1", "trace-1");

        expect(summary.computedInput).toBe(FULL_INPUT);
        expect(summary.computedOutput).toBe(FULL_OUTPUT);
        expect(summary.computedInput).not.toBe(PREVIEW_INPUT);
        // Resolved successfully → never flagged incomplete.
        expect(summary.inputTruncated).toBeFalsy();
        expect(summary.outputTruncated).toBeFalsy();
      });
    });

    describe("when the trace occurred before the visibility cutoff", () => {
      /** @scenario Full-content resolution does not bypass the visibility window */
      it("teases the resolved full content and flags redaction, never leaking the full value", async () => {
        const service = new TraceSummaryService(
          makeRepository(
            makeSummary({ occurredAt: Date.now() - 30 * DAY_MS }),
          ),
          makeDeps([makeOffloadedRootSpan()], {
            "langwatch.input": FULL_INPUT,
            "langwatch.output": FULL_OUTPUT,
          }),
        );

        const summary = await service.getByTraceId("proj-1", "trace-1", {
          visibilityCutoffMs: Date.now() - 14 * DAY_MS,
        });

        // The teaser is derived from the RESOLVED full value (resolution ran
        // BEFORE the gate), then capped by the visibility window — proving
        // resolution neither bypasses the gate nor runs after it.
        expect(summary.redactedByVisibilityWindow).toBe(true);
        expect(summary.computedInput).toBe(teaserOf(FULL_INPUT));
        expect(summary.computedOutput).toBe(teaserOf(FULL_OUTPUT));
        expect(summary.computedInput).not.toBe(FULL_INPUT);
        expect(summary.computedInput).toHaveLength(
          TEASER_MAX_CHARS + TEASER_ELLIPSIS.length,
        );
      });
    });
  });

  describe("given a trace whose IO eventref points at a missing event_log row", () => {
    describe("when getByTraceId is called with blob-resolution deps", () => {
      /** @scenario Summary panel shows an incomplete-content indicator when resolution fails */
      it("keeps the preview value and flags the field as truncated without throwing", async () => {
        const service = new TraceSummaryService(
          makeRepository(makeSummary()),
          // Empty blob store → getFromEventLog always throws BlobNotFoundError.
          makeDeps([makeOffloadedRootSpan()], {}),
        );

        const summary = await service.getByTraceId("proj-1", "trace-1");

        // Documented error policy: a stale/missing ref never breaks the read —
        // the stored preview stays in place.
        expect(summary.computedInput).toBe(PREVIEW_INPUT);
        expect(summary.computedOutput).toBe(PREVIEW_OUTPUT);
        // ...but the field is marked so the UI can warn content may be incomplete.
        expect(summary.inputTruncated).toBe(true);
        expect(summary.outputTruncated).toBe(true);
      });
    });
  });
});
