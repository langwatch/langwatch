/**
 * Dedup port is structural only: assignable by shape, not by class inheritance.
 */

import { describe, expect, it } from "vitest";

import {
  type SpanDedupClaim,
  type SpanDedupRef,
  type TraceSpanDedupRepository,
} from "../../repositories/trace-span-dedup.repository.ts";

describe("TraceSpanDedupRepository", () => {
  describe("given a plain object with the port's three methods", () => {
    it("is usable as the port, so a caller needs no adapter class", () => {
      const seen: SpanDedupRef[] = [];
      const dedup: TraceSpanDedupRepository = {
        async claimProcessing(span: SpanDedupRef): Promise<SpanDedupClaim> {
          seen.push(span);
          return { outcome: "acquired" };
        },
        async confirmProcessed(span: SpanDedupRef) {
          seen.push(span);
        },
        async releaseOnFailure(span: SpanDedupRef) {
          seen.push(span);
        },
      };

      void dedup.claimProcessing({
        tenantId: "tenant-1",
        traceId: "trace-1",
        spanId: "span-1",
      });

      expect(seen).toEqual([{ tenantId: "tenant-1", traceId: "trace-1", spanId: "span-1" }]);
    });
  });
});
