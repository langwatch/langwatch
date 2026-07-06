import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractAiCallFailedInfo,
  extractMissingModelInfo,
  extractProviderDisabledInfo,
} from "../../../utils/trpcError";
import { shouldShowGenericTranslateError } from "../translationError";

// The gating logic is what we own here; the extractors are a boundary
// (tested in utils/trpcError). Mock them so we can prove the fallback fires
// only when none matched.
vi.mock("../../../utils/trpcError", () => ({
  extractMissingModelInfo: vi.fn(),
  extractAiCallFailedInfo: vi.fn(),
  extractProviderDisabledInfo: vi.fn(),
}));

const allReturnNull = () => {
  vi.mocked(extractMissingModelInfo).mockReturnValue(null);
  vi.mocked(extractAiCallFailedInfo).mockReturnValue(null);
  vi.mocked(extractProviderDisabledInfo).mockReturnValue(null);
};

describe("shouldShowGenericTranslateError()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allReturnNull();
  });

  describe("when no typed model-error handler matches", () => {
    it("returns true so the caller shows a generic fallback toast", () => {
      expect(
        shouldShowGenericTranslateError(new Error("Project not found")),
      ).toBe(true);
    });
  });

  describe("when the missing-model handler already surfaces the failure", () => {
    it("returns false so the toast is not duplicated", () => {
      vi.mocked(extractMissingModelInfo).mockReturnValue({
        featureKey: "translate.text",
        featureDisplayName: "Inline translation",
        role: "FAST",
      });

      expect(shouldShowGenericTranslateError({})).toBe(false);
    });
  });

  describe("when the AI-call-failed handler already surfaces the failure", () => {
    it("returns false so the toast is not duplicated", () => {
      vi.mocked(extractAiCallFailedInfo).mockReturnValue({
        featureKey: "translate.text",
        featureDisplayName: "Inline translation",
        role: "FAST",
        errorMessage: "Invalid API key",
      });

      expect(shouldShowGenericTranslateError({})).toBe(false);
    });
  });

  describe("when the provider-disabled handler already surfaces the failure", () => {
    it("returns false so the toast is not duplicated", () => {
      vi.mocked(extractProviderDisabledInfo).mockReturnValue({
        featureKey: "translate.text",
        featureDisplayName: "Inline translation",
        role: "FAST",
        projectId: "project_abc123",
        resolvedScope: "project",
        resolvedModel: "openai/gpt-5-mini",
        providerKey: "openai",
        alternate: null,
      });

      expect(shouldShowGenericTranslateError({})).toBe(false);
    });
  });
});
