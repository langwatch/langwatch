import { describe, expect, it, vi } from "vitest";

import type { ModelParamsFailureReason } from "../execution/data-prefetcher";
import { logPrefetchFailure } from "../scenario.processor";

function makeJobLogger() {
  return { warn: vi.fn(), error: vi.fn() };
}

function logFor(reason: ModelParamsFailureReason | undefined) {
  const jobLogger = makeJobLogger();
  logPrefetchFailure({
    // The helper only reads warn/error off the logger; the rest of the child
    // logger's surface is irrelevant to the classification under test.
    jobLogger: jobLogger as unknown as Parameters<
      typeof logPrefetchFailure
    >[0]["jobLogger"],
    prefetchResult: {
      success: false,
      error: "the run could not start",
      ...(reason ? { reason } : {}),
    },
  });
  return jobLogger;
}

describe("logPrefetchFailure", () => {
  describe("when the customer's own configuration blocked the run", () => {
    /** @scenario A run blocked by a disabled provider is not reported as our failure */
    it("logs a disabled provider below error, naming the reason", () => {
      const jobLogger = logFor("provider_not_enabled");

      expect(jobLogger.error).not.toHaveBeenCalled();
      expect(jobLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "provider_not_enabled" }),
        expect.stringContaining("blocked by project configuration"),
      );
    });

    /** @scenario A project with no model chosen for scenarios is the customer's to fix */
    it("logs a project with no model chosen below error", () => {
      const jobLogger = logFor("model_not_configured");

      expect(jobLogger.error).not.toHaveBeenCalled();
      expect(jobLogger.warn).toHaveBeenCalled();
    });

    it.each([
      "invalid_model_format",
      "provider_not_found",
      "missing_params",
    ] as const)("logs %s below error too", (reason) => {
      const jobLogger = logFor(reason);

      expect(jobLogger.error).not.toHaveBeenCalled();
      expect(jobLogger.warn).toHaveBeenCalled();
    });
  });

  describe("when the failure is not one we recognise as the customer's", () => {
    /** @scenario A failure we do not recognise stays ours */
    it("keeps a preparation error at error level", () => {
      const jobLogger = logFor("preparation_error");

      expect(jobLogger.warn).not.toHaveBeenCalled();
      expect(jobLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "preparation_error" }),
        "Failed to prefetch scenario data",
      );
    });

    /** @scenario A failure carrying no reason at all stays ours */
    it("keeps a failure with no reason at error level", () => {
      const jobLogger = logFor(undefined);

      expect(jobLogger.warn).not.toHaveBeenCalled();
      expect(jobLogger.error).toHaveBeenCalled();
    });

    it("keeps a reason added later at error level until someone classifies it", () => {
      const jobLogger = logFor(
        "some_future_reason" as ModelParamsFailureReason,
      );

      expect(jobLogger.warn).not.toHaveBeenCalled();
      expect(jobLogger.error).toHaveBeenCalled();
    });
  });
});
