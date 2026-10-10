/**
 * A refused export names its wait as `meta.retryAfterMs`, which the REST door renders
 * as `Retry-After`.
 * @see modules/trace/specs/trace-export-limits.feature
 */
import { describe, expect, it } from "vitest";

import { TraceExportRateLimitedError } from "../features/export/trace-export.errors.ts";

describe("TraceExportRateLimitedError", () => {
  describe("when the rate window is full", () => {
    it("is a 429 that carries the wait in milliseconds", () => {
      const error = new TraceExportRateLimitedError({ reason: "rate", retryAfterSeconds: 42 });

      expect(error.httpStatus).toBe(429);
      expect(error.meta.retryAfterMs).toBe(42_000);
    });
  });

  describe("when every slot is held", () => {
    it("names no wait", () => {
      const error = new TraceExportRateLimitedError({ reason: "concurrency" });

      expect(error.meta.retryAfterMs).toBeUndefined();
    });
  });
});
