import { isHandledByGlobalHandler } from "@langwatch/browser-host/errors";
/**
 * @vitest-environment jsdom
 * The interceptor that turns a failed call's serialised refusal into the toast.
 * Its installation on the shell's failure seam is not proven here.
 * @see specs/model-providers/missing-model-popup.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { Toaster, toaster } from "@langwatch/design-system/toaster";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createModelErrorInterceptor } from "../model-error-interceptor.ts";

beforeEach(() => {
  toaster.remove();
});
afterEach(() => {
  cleanup();
  toaster.remove();
});

function failedCall(cause: Record<string, unknown>): Error {
  const error = new Error("model_not_configured");
  Object.assign(error, { data: { code: "BAD_REQUEST", cause } });
  return error;
}

function interceptor() {
  return createModelErrorInterceptor({
    navigate: vi.fn(),
    clearProjectFeatureModel: vi.fn(async () => {}),
  });
}

describe("the model error interceptor", () => {
  describe("given a failed call that carries MODEL_NOT_CONFIGURED", () => {
    it("opens the toast and marks the failure handled so no generic error toast follows", async () => {
      renderWithDesignSystem(<Toaster />);
      const error = failedCall({
        code: "MODEL_NOT_CONFIGURED",
        featureKey: "traces.ai_search",
        featureDisplayName: "AI search",
        role: "FAST",
        projectId: "project-1",
      });

      const reported = interceptor()(error);

      expect(reported).toBe(true);
      expect(isHandledByGlobalHandler(error)).toBe(true);
      expect(await screen.findByText(/Model not configured for AI search/i)).toBeInTheDocument();
    });
  });

  describe("given a failed call about something else", () => {
    it("reports nothing and leaves the failure to the screen", () => {
      const error = failedCall({ limitType: "members", current: 3, max: 3 });

      expect(interceptor()(error)).toBe(false);
      expect(isHandledByGlobalHandler(error)).toBe(false);
    });
  });
});
