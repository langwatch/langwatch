import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractAiCallFailedInfo,
  extractMissingModelInfo,
  extractProviderDisabledInfo,
} from "../../../trpc-error";
import { shouldShowGenericTranslateError } from "../translation-error";

// The gating logic is what we own here; the extractors are a boundary
// (tested in utils/trpcError). Mock them so we can prove the fallback fires
// only when none matched.
// Aliased, not relative: the relative form has to be re-counted every time
// this file moves, and a path that resolves to nothing mocks nothing — the
// import above still binds the real module and every `vi.mocked(...)` call
// fails on it.
vi.mock("../../../trpc-error", () => ({
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
      expect(shouldShowGenericTranslateError(new Error("Project not found"))).toBe(true);
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
      // No `errorMessage`: the extracted shape stopped carrying the provider's
      // own sentence when this branch stopped relaying a third party's prose to
      // the customer. The handler is identified by `featureKey` and `role`; the
      // words come from the registry.
      vi.mocked(extractAiCallFailedInfo).mockReturnValue({
        featureKey: "translate.text",
        featureDisplayName: "Inline translation",
        role: "FAST",
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
