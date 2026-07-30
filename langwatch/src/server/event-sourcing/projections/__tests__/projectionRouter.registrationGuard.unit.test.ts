import { describe, expect, it, vi } from "vitest";
import {
  createMockFoldProjectionDefinition,
  createMockFoldProjectionStore,
  createMockQueueManager,
  TEST_CONSTANTS,
} from "../../services/__tests__/testHelpers";
import { MAX_APPLIED_EVENT_IDS } from "../foldCache/foldCacheEntry";
import type { FoldProjectionStore } from "../foldProjection.types";
import { ProjectionRouter } from "../projectionRouter";

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

function createRouter() {
  return new ProjectionRouter(
    TEST_CONSTANTS.AGGREGATE_TYPE,
    TEST_CONSTANTS.PIPELINE_NAME,
    createMockQueueManager(),
  );
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
});
