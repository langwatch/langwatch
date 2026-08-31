/**
 * The dedup port is a shape, not a base class to inherit.
 *
 * The app holds its own Redis-backed dedup service and hands it to the Trace
 * pipeline. That only works while `TraceSpanDedupPort` stays structurally
 * satisfiable — no private members, no constructor to call — so a plain
 * object with the three methods is assignable to it.
 *
 * If that stops being true, the app needs an adapter class again, and this is
 * where it says so rather than a composition file failing to compile.
 */

import { describe, expect, it } from "vitest";
import { TraceSpanDedupPort, type SpanDedupRef } from "../trace-ingestion.service";

describe("TraceSpanDedupPort", () => {
  describe("given a plain object with the port's three methods", () => {
    it("is usable as the port, so a caller needs no adapter class", () => {
      const seen: SpanDedupRef[] = [];
      const dedup: TraceSpanDedupPort = {
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
