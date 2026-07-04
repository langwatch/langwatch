import { MAX_WINDOW_SPAN_MS } from "@ee/governance/services/personalUsage.service";
import { describe, expect, it } from "vitest";

import { meUsageQuerySchema } from "../schemas";

describe("meUsageQuerySchema", () => {
  describe("given both window bounds within the span cap", () => {
    it("accepts the window", () => {
      const result = meUsageQuerySchema.safeParse({
        windowStartMs: 0,
        windowEndMs: MAX_WINDOW_SPAN_MS,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("given a window wider than the span cap", () => {
    // dailyBuckets allocates one bucket per day of the window on the app
    // server, so an unbounded span is an event-loop hang — the schema must
    // reject it before it reaches the service.
    it("rejects the window", () => {
      const result = meUsageQuerySchema.safeParse({
        windowStartMs: 0,
        windowEndMs: MAX_WINDOW_SPAN_MS + 1,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("given only one bound", () => {
    it("rejects the half-specified window", () => {
      expect(meUsageQuerySchema.safeParse({ windowStartMs: 0 }).success).toBe(
        false,
      );
    });
  });

  describe("given an inverted window", () => {
    it("rejects it", () => {
      expect(
        meUsageQuerySchema.safeParse({ windowStartMs: 10, windowEndMs: 5 })
          .success,
      ).toBe(false);
    });
  });
});
