import { describe, expect, it } from "vitest";
import { MAX_APPLIED_EVENT_IDS } from "../../../../projections/foldCache/foldCacheEntry";
import {
  TRACE_SUMMARY_COALESCE_MAX_BATCH,
  TraceSummaryFoldProjection,
} from "../traceSummary.foldProjection";

/**
 * traceSummary is the hottest fold in the system — every trace event routes
 * through it and fans out to its reactor subscribers. Without a coalesce
 * ceiling the framework default is 1: one load/apply/store cycle per queued
 * event, the O(n²) drain pattern measured during the 2026-07-31 backlog.
 * These tests pin the ceiling and its safety bound.
 */
describe("traceSummary fold coalescing", () => {
  describe("when the fold projection is constructed", () => {
    it("declares a coalesce ceiling above the framework default of 1", () => {
      const projection = new TraceSummaryFoldProjection({
        store: {} as never,
      });
      expect(projection.options.coalesceMaxBatch).toBe(
        TRACE_SUMMARY_COALESCE_MAX_BATCH,
      );
      expect(TRACE_SUMMARY_COALESCE_MAX_BATCH).toBeGreaterThan(1);
    });

    it("stays below the applied-event-id watermark cap that redelivery dedup depends on", () => {
      expect(TRACE_SUMMARY_COALESCE_MAX_BATCH).toBeLessThan(
        MAX_APPLIED_EVENT_IDS,
      );
    });
  });
});
