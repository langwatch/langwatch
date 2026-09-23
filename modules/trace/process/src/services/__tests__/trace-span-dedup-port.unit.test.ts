/**
 * Dedup port is structural only: assignable by shape, not by class inheritance.
 */

import { describe, expect, it } from "vitest";

import { type TraceSpanDedup, type SpanDedupRef } from "../trace-ingestion.service.ts";

describe("TraceSpanDedup", () => {
  describe("given a plain object with the port's three methods", () => {
    it("is usable as the port, so a caller needs no adapter class", () => {
      const seen: SpanDedupRef[] = [];
      const dedup: TraceSpanDedup = {
        async tryAcquireProcessingLock(span: SpanDedupRef) {
          seen.push(span);
          return true;
        },
        async confirmProcessed(span: SpanDedupRef) {
          seen.push(span);
        },
        async releaseOnFailure(span: SpanDedupRef) {
          seen.push(span);
        },
      };

      void dedup.tryAcquireProcessingLock({
        tenantId: "tenant-1",
        traceId: "trace-1",
        spanId: "span-1",
      });

      expect(seen).toEqual([{ tenantId: "tenant-1", traceId: "trace-1", spanId: "span-1" }]);
    });
  });
});
