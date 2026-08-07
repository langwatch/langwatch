import { describe, expect, it, vi } from "vitest";
import type { AggregateType } from "../../domain/aggregateType";
import {
  createMockFoldProjectionDefinition,
  createMockFoldProjectionStore,
  createMockQueueManager,
  TEST_CONSTANTS,
} from "../../services/__tests__/testHelpers";
import { TIME_LOCAL_AGGREGATE_TYPES } from "../../stores/rehydrationWindow";
import { MAX_APPLIED_EVENT_IDS } from "../foldCache/foldCacheEntry";
import type { FoldProjectionStore } from "../foldProjection.types";
import { ProjectionRouter } from "../projectionRouter";

/** An aggregate whose rows accumulate over its whole life, so no window bounds them. */
const LONG_LIVED_AGGREGATE_TYPE =
  "simulation_set" as const satisfies AggregateType;
const READ_WINDOW = { widthMs: 7 * 24 * 60 * 60 * 1000 } as const;

/**
 * A store carrying a durable applied-event-id watermark: it answers reads with
 * the applied set (`getWithApplied`), the shape the executor duck-types to
 * decide a fold has a redelivery-dedup window to protect.
 */
function createDurableWatermarkStore<State>(): FoldProjectionStore<State> {
  return {
    ...createMockFoldProjectionStore<State>(),
    getWithApplied: vi
      .fn()
      .mockResolvedValue({ state: null, appliedEventIds: [] }),
  } as FoldProjectionStore<State>;
}

function createRouter(
  aggregateType: AggregateType = TEST_CONSTANTS.AGGREGATE_TYPE,
) {
  return new ProjectionRouter({
    aggregateType,
    pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
    queueManager: createMockQueueManager(),
  });
}

describe("ProjectionRouter registration guard", () => {
  describe("given a fold whose store exposes a durable watermark", () => {
    describe("when its coalesce batch reaches the applied-id cap", () => {
      it("rejects the fold at registration", () => {
        const fold = createMockFoldProjectionDefinition("durable-at-cap", {
          store: createDurableWatermarkStore(),
          options: { coalesceMaxBatch: MAX_APPLIED_EVENT_IDS },
        });

        expect(() => createRouter().registerFoldProjection(fold)).toThrow(
          /breaks redelivery dedup for durable-watermark folds/,
        );
      });

      it("names the fold and both values in the error", () => {
        const fold = createMockFoldProjectionDefinition("durable-over-cap", {
          store: createDurableWatermarkStore(),
          options: { coalesceMaxBatch: MAX_APPLIED_EVENT_IDS + 1 },
        });

        expect(() => createRouter().registerFoldProjection(fold)).toThrow(
          new RegExp(
            `durable-over-cap.*${MAX_APPLIED_EVENT_IDS + 1}.*${MAX_APPLIED_EVENT_IDS}`,
          ),
        );
      });
    });

    describe("when its coalesce batch stays under the applied-id cap", () => {
      it("registers the fold", () => {
        const fold = createMockFoldProjectionDefinition("durable-under-cap", {
          store: createDurableWatermarkStore(),
          options: { coalesceMaxBatch: MAX_APPLIED_EVENT_IDS - 1 },
        });

        expect(() => createRouter().registerFoldProjection(fold)).not.toThrow();
      });
    });
  });

  describe("given a cache-only fold whose store has no durable watermark", () => {
    describe("when its coalesce batch reaches the applied-id cap", () => {
      it("registers the fold, since it trims consistently everywhere", () => {
        const fold = createMockFoldProjectionDefinition("cache-only-at-cap", {
          store: createMockFoldProjectionStore(),
          options: { coalesceMaxBatch: MAX_APPLIED_EVENT_IDS },
        });

        expect(() => createRouter().registerFoldProjection(fold)).not.toThrow();
      });
    });
  });

  describe("given a fold that trusts an absent miss on a windowed read", () => {
    const trustedWindowedFold = (name: string) =>
      createMockFoldProjectionDefinition(name, {
        options: { trustAbsentMiss: true, readWindow: READ_WINDOW },
      });

    describe("when the aggregate it is registered under can stay live indefinitely", () => {
      /**
       * The window is the whole basis of the trust. On an aggregate whose rows
       * legitimately age past any width, an absent windowed read means "outside
       * the window", not "never committed", and folding on from `init()` wipes
       * live state. Nothing downstream can tell the two apart, so the only
       * place to stop it is before the fold ever runs.
       */
      /** @scenario a trusted fold's windowed read is backed by a time-local lifetime */
      it("refuses the registration", () => {
        expect(() =>
          createRouter(LONG_LIVED_AGGREGATE_TYPE).registerFoldProjection(
            trustedWindowedFold("trusted-on-long-lived"),
          ),
        ).toThrow(/is not time-local/);
      });

      it("names the fold and the aggregate type in the error", () => {
        expect(() =>
          createRouter(LONG_LIVED_AGGREGATE_TYPE).registerFoldProjection(
            trustedWindowedFold("trusted-on-long-lived"),
          ),
        ).toThrow(
          new RegExp(`trusted-on-long-lived.*${LONG_LIVED_AGGREGATE_TYPE}`),
        );
      });
    });

    describe("when the aggregate it is registered under is time-local", () => {
      it("registers the fold", () => {
        expect(
          TIME_LOCAL_AGGREGATE_TYPES.has(TEST_CONSTANTS.AGGREGATE_TYPE),
        ).toBe(true);

        expect(() =>
          createRouter().registerFoldProjection(
            trustedWindowedFold("trusted-on-time-local"),
          ),
        ).not.toThrow();
      });
    });
  });

  describe("given a fold that trusts an absent miss without declaring a read window", () => {
    describe("when the aggregate it is registered under can stay live indefinitely", () => {
      it("registers the fold, since an unwindowed absence hides nothing", () => {
        const fold = createMockFoldProjectionDefinition("trusted-unwindowed", {
          options: { trustAbsentMiss: true },
        });

        expect(() =>
          createRouter(LONG_LIVED_AGGREGATE_TYPE).registerFoldProjection(fold),
        ).not.toThrow();
      });
    });
  });
});
