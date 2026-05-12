import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetPosthogRateLimitLogDowngradeForTests,
  installPosthogRateLimitLogDowngrade,
} from "../posthogRateLimitLogDowngrade";

describe("installPosthogRateLimitLogDowngrade", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let originalError: typeof console.error;

  beforeEach(() => {
    __resetPosthogRateLimitLogDowngradeForTests();
    originalError = console.error;
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    // Restore in case the patch swapped console.error mid-test.
    console.error = originalError;
    __resetPosthogRateLimitLogDowngradeForTests();
  });

  describe("when a PostHog rate-limit message is logged at error level", () => {
    it("re-emits the message at warn level instead", () => {
      installPosthogRateLimitLogDowngrade();

      console.error(
        "[PostHog.js] This capture call is ignored due to client rate limiting.",
      );

      expect(warnSpy).toHaveBeenCalledWith(
        "[PostHog.js] This capture call is ignored due to client rate limiting.",
      );
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  describe("when a non-PostHog error is logged", () => {
    it("passes through to console.error untouched", () => {
      installPosthogRateLimitLogDowngrade();

      console.error("tRPC 500: failed to fetch traces", { code: 500 });

      expect(errorSpy).toHaveBeenCalledWith(
        "tRPC 500: failed to fetch traces",
        { code: 500 },
      );
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe("when a PostHog non-rate-limit error is logged", () => {
    it("passes through to console.error untouched", () => {
      installPosthogRateLimitLogDowngrade();

      console.error("[PostHog.js] Failed to capture event: network down");

      expect(errorSpy).toHaveBeenCalledWith(
        "[PostHog.js] Failed to capture event: network down",
      );
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe("when called multiple times", () => {
    it("only patches console.error once", () => {
      installPosthogRateLimitLogDowngrade();
      const patchedOnce = console.error;
      installPosthogRateLimitLogDowngrade();
      expect(console.error).toBe(patchedOnce);
    });
  });
});
