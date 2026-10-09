/**
 * Regression: a span start time wrong by orders of magnitude used to block a
 * whole project's span lane.
 *
 * The KSUID a span record's id is minted from carries its start time in a
 * 48-bit SECONDS field, so a millisecond value scaled into nanoseconds twice
 * over is refused there — inside normalization, which every trace-processing
 * consumer of `span_received` runs. The event is already appended and the throw
 * is classed retryable, so the group queue re-staged the same job until the
 * group was blocked.
 *
 * These tests drive the REAL normalization and the REAL projections, not a
 * string assertion about either: the first one proves the throw is still there
 * (defence in depth stays a throw on purpose — a clamped id would collide), the
 * rest prove nobody reaches it any more.
 */

import { describe, expect, it } from "vitest";
import { CanonicalizeSpanAttributesService } from "~/server/app-layer/traces/canonicalisation";
import { SpanNormalizationPipelineService } from "~/server/app-layer/traces/span-normalization.service";
import type { SpanReceivedEvent } from "../../schemas/events";
import { SpanStorageMapProjection } from "../spanStorage.mapProjection";
import { TraceAnalyticsFoldProjection } from "../traceAnalytics.foldProjection";
import { TraceAnalyticsRollupMapProjection } from "../traceAnalyticsRollup.mapProjection";
import { TraceSummaryFoldProjection } from "../traceSummary.foldProjection";
import { createSpanReceivedEvent } from "./fixtures/trace-summary-test.fixtures";

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

const noopAppendStore = { append: async () => {}, bulkAppend: async () => {} };
const noopFoldStore = { store: async () => {}, get: async () => null };

describe("given a span whose start time cannot be stored", () => {
  describe("when the span is normalized directly", () => {
    it("still refuses it, because the record id's timestamp field is 48-bit seconds", () => {
      const normalization = new SpanNormalizationPipelineService(
        new CanonicalizeSpanAttributesService(),
      );
      const event = unstorableEvent();

      let thrown: unknown;
      try {
        normalization.normalizeSpanReceived(
          event.tenantId,
          event.data.span,
          event.data.resource,
          event.data.instrumentationScope,
        );
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
      const projection = new SpanStorageMapProjection({
        store: noopAppendStore as never,
      });

      expect(projection.map(unstorableEvent())).toBeNull();
    });
  });

  describe("when the analytics-rollup projection maps it", () => {
    /** @scenario "A stored span whose start time cannot be stored is skipped without blocking the rest of the project's spans" */
    it("skips the span instead of throwing", () => {
      const projection = new TraceAnalyticsRollupMapProjection({
        store: noopAppendStore as never,
      });

      expect(projection.map(unstorableEvent())).toBeNull();
    });
  });

  describe("when the trace-summary fold applies it", () => {
    /** @scenario "A stored span whose start time cannot be stored is skipped without blocking the rest of the project's spans" */
    it("leaves the trace's state untouched instead of throwing", () => {
      const projection = new TraceSummaryFoldProjection({
        store: noopFoldStore,
      });
      const state = projection.init();

      const folded = projection.apply(state, unstorableEvent());

      // Everything but the fold's own `updatedAt` stamp: no span counted, no
      // timing seeded, and nothing anchored off the unstorable value.
      expect(folded).toEqual({ ...state, updatedAt: folded.updatedAt });
    });
  });

  describe("when the trace-analytics fold applies it", () => {
    /** @scenario "A stored span whose start time cannot be stored is skipped without blocking the rest of the project's spans" */
    it("leaves the trace's state untouched instead of throwing", () => {
      const projection = new TraceAnalyticsFoldProjection({
        store: noopFoldStore,
      });
      const state = projection.init();

      const folded = projection.apply(state, unstorableEvent());

      expect(folded).toEqual({ ...state, updatedAt: folded.updatedAt });
    });
  });

  describe("when a sibling span with an ordinary start time follows it", () => {
    /** @scenario "A stored span whose start time cannot be stored is skipped without blocking the rest of the project's spans" */
    it("still reaches storage, so one bad span does not cost the project its lane", () => {
      const projection = new SpanStorageMapProjection({
        store: noopAppendStore as never,
      });

      expect(projection.map(unstorableEvent())).toBeNull();
      expect(projection.map(storableEvent())).not.toBeNull();
    });

    /** @scenario "A stored span whose start time cannot be stored is skipped without blocking the rest of the project's spans" */
    it("still sets the trace's timing in the summary fold", () => {
      const projection = new TraceSummaryFoldProjection({
        store: noopFoldStore,
      });

      const afterUnstorable = projection.apply(
        projection.init(),
        unstorableEvent(),
      );
      const afterStorable = projection.apply(afterUnstorable, storableEvent());

      expect(afterStorable.occurredAt).toBe(1_700_000_000_500);
      expect(afterStorable.totalDurationMs).toBe(2000);
    });
  });
});

describe("given a span whose start time is far in the future but storable", () => {
  describe("when the span-storage projection maps it", () => {
    /** @scenario "A span starting far in the future is still accepted when storage can hold it" */
    it("stores it, because the change refuses only what cannot be stored", () => {
      const projection = new SpanStorageMapProjection({
        store: noopAppendStore as never,
      });
      const year2100Ms = Date.UTC(2100, 0, 1);

      const record = projection.map(
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
