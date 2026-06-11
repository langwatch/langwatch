import { describe, expect, it } from "vitest";
import { buildRetryAfterMessage } from "../rateLimitMessage";

describe("buildRetryAfterMessage", () => {
  describe("given a reset point several seconds in the future", () => {
    it("rounds up to whole seconds and pluralises", () => {
      const now = 1_000_000;
      const message = buildRetryAfterMessage({
        prefix: "Too many test fires.",
        resetAt: now + 4_200,
        now,
      });
      expect(message).toBe("Too many test fires. Try again in 5 seconds.");
    });
  });

  describe("given a reset point exactly one second away", () => {
    it("uses the singular form", () => {
      const now = 1_000_000;
      const message = buildRetryAfterMessage({
        prefix: "Too many test fires.",
        resetAt: now + 1_000,
        now,
      });
      expect(message).toBe("Too many test fires. Try again in 1 second.");
    });
  });

  describe("given a reset point already in the past", () => {
    it("clamps the retry to at least one second", () => {
      const now = 1_000_000;
      const message = buildRetryAfterMessage({
        prefix: "Too many test fires.",
        resetAt: now - 5_000,
        now,
      });
      expect(message).toBe("Too many test fires. Try again in 1 second.");
    });
  });
});
