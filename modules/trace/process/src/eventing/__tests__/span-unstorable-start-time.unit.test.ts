/**
 * Regression: a span start time wrong by orders of magnitude used to block a
 * whole project's span lane. Drives the REAL normalization and projections.
 * @see specs/traces/span-start-time-must-be-storable.feature
 */
import type { SpanReceivedEvent } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { TraceCanonicalisationService } from "../../services/trace-canonicalisation.service.ts";
import { SpanStorageMapProjection } from "../span-storage.projection.ts";
import { TraceAnalyticsFoldProjection } from "../trace-derived.projection.ts";
import { TraceAnalyticsRollupMapProjection } from "../trace-rollup.projection.ts";
import { TraceSummaryFoldProjection } from "../trace-summary.projection.ts";
import { createSpanReceivedEvent, createTestRuntime } from "./trace-summary-test.fixtures.ts";

/**
 * A present-day millisecond value pushed through a millisecond→nanosecond
 * conversion twice: the shape the production failure arrived in.
 */
const PRESENT_DAY_MS = 1_700_000_000_500n;
const TWICE_SCALED_NANO = String(PRESENT_DAY_MS * 1_000_000n * 1_000_000n);

function unstorableEvent(): SpanReceivedEvent {
  return createSpanReceivedEvent({
    tenantId: "project-regression",
    traceId: "aaaa0000000000000000000000000009",
    spanId: "bbbb000000000009",
    startTimeUnixNano: TWICE_SCALED_NANO,
    endTimeUnixNano: TWICE_SCALED_NANO,
  });
}

function storableEvent(): SpanReceivedEvent {
  return createSpanReceivedEvent({
    tenantId: "project-regression",
    traceId: "aaaa0000000000000000000000000009",
    spanId: "bbbb00000000000a",
  });
}

const runtime = createTestRuntime();
const noopFoldStore = { store: async () => {}, get: async () => ({ kind: "empty" as const }) };
const noopAppendStore = { append: async () => {}, bulkAppend: async () => {} } as never;

const spanStorage = () =>
  SpanStorageMapProjection.create({
    store: noopAppendStore,
    spanCostService: runtime.spanCost,
    spanNormalization: runtime.spanNormalization,
  });
const analyticsRollup = () =>
  TraceAnalyticsRollupMapProjection.create({
    store: noopAppendStore,
    spanCostService: runtime.spanCost,
    spanNormalization: runtime.spanNormalization,
  });
const summaryFold = () =>
  TraceSummaryFoldProjection.create({
    store: noopFoldStore,
    traceCanonicalisation: TraceCanonicalisationService.create(),
    runtime,
  });
const analyticsFold = () =>
  TraceAnalyticsFoldProjection.create({
    store: noopFoldStore,
    traceCanonicalisation: TraceCanonicalisationService.create(),
    runtime,
  });

describe("given a span whose start time cannot be stored", () => {
  describe("when the span is normalized directly", () => {
    it("still refuses it, because the record id's timestamp field is 48-bit seconds", () => {
      const normalization = runtime.spanNormalization;
      const event = unstorableEvent();

      let thrown: unknown;
      try {
        normalization.normalizeSpanReceived({
          tenantId: event.tenantId,
          span: event.data.span,
          resource: event.data.resource,
          instrumentationScope: event.data.instrumentationScope,
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).name).toBe("ValidationError");
      expect((thrown as Error).message).toContain("uint48");
    });
  });

  describe("when the span-storage projection maps it", () => {
    /** @scenario "A stored span whose start time cannot be stored is skipped without blocking the rest of the project's spans" */
    it("skips the span instead of throwing", () => {
      const projection = spanStorage();

      expect(projection.mapTraceSpanReceived(unstorableEvent())).toBeNull();
    });
  });

  describe("when the analytics-rollup projection maps it", () => {
    /** @scenario "A stored span whose start time cannot be stored is skipped without blocking the rest of the project's spans" */
    it("skips the span instead of throwing", () => {
      const projection = analyticsRollup();

      expect(projection.mapTraceSpanReceived(unstorableEvent())).toBeNull();
    });
  });

  describe("when the trace-summary fold applies it", () => {
    /** @scenario "A stored span whose start time cannot be stored is skipped without blocking the rest of the project's spans" */
    it("leaves the trace's state untouched instead of throwing", () => {
      const projection = summaryFold();
      const state = projection.init();

      const folded = projection.handleTraceSpanReceived(unstorableEvent(), state);

      // No span counted, no timing seeded, nothing anchored off the value.
      expect(folded).toBe(state);
    });
  });

  describe("when the trace-analytics fold applies it", () => {
    /** @scenario "A stored span whose start time cannot be stored is skipped without blocking the rest of the project's spans" */
    it("leaves the trace's state untouched instead of throwing", () => {
      const projection = analyticsFold();
      const state = projection.init();

      const folded = projection.handleTraceSpanReceived(unstorableEvent(), state);

      expect(folded).toBe(state);
    });
  });

  describe("when a sibling span with an ordinary start time follows it", () => {
    /** @scenario "A stored span whose start time cannot be stored is skipped without blocking the rest of the project's spans" */
    it("still reaches storage, so one bad span does not cost the project its lane", () => {
      const projection = spanStorage();

      expect(projection.mapTraceSpanReceived(unstorableEvent())).toBeNull();
      expect(projection.mapTraceSpanReceived(storableEvent())).not.toBeNull();
    });

    /** @scenario "A stored span whose start time cannot be stored is skipped without blocking the rest of the project's spans" */
    it("still sets the trace's timing in the summary fold", () => {
      const projection = summaryFold();

      const afterUnstorable = projection.handleTraceSpanReceived(
        unstorableEvent(),
        projection.init(),
      );
      const afterStorable = projection.handleTraceSpanReceived(storableEvent(), afterUnstorable);

      expect(afterStorable.occurredAt).toBe(1_700_000_000_500);
      expect(afterStorable.totalDurationMs).toBe(2000);
    });
  });
});

describe("given a span whose start time is far in the future but storable", () => {
  describe("when the span-storage projection maps it", () => {
    /** @scenario "A span starting far in the future is still accepted when storage can hold it" */
    it("stores it, because the change refuses only what cannot be stored", () => {
      const projection = spanStorage();
      const year2100Ms = Date.UTC(2100, 0, 1);

      const record = projection.mapTraceSpanReceived(
        createSpanReceivedEvent({
          startTimeUnixNano: String(BigInt(year2100Ms) * 1_000_000n),
          endTimeUnixNano: String(BigInt(year2100Ms + 2000) * 1_000_000n),
        }),
      );

      expect(record).not.toBeNull();
      expect(record?.startTimeUnixMs).toBe(year2100Ms);
    });
  });
});
