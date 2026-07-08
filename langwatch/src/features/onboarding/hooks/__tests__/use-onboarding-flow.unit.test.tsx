/**
 * @vitest-environment jsdom
 *
 * ADR-038: the intent screen blocks progression until a choice is made —
 * pure hook state, no rendering beyond renderHook.
 *
 * Spec: specs/features/onboarding/intent-fork.feature
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useOnboardingFlow } from "../use-onboarding-flow";
import { OnboardingScreenIndex } from "../../types/types";

vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({ data: { IS_SAAS: true }, isLoading: false }),
}));

const flagState = vi.hoisted(() => ({ enabled: true, isLoading: false }));

vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ ...flagState }),
}));

vi.mock("~/utils/attribution", () => ({
  readAttribution: () => ({}),
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ query: {}, push: vi.fn(), replace: vi.fn() }),
}));

describe("useOnboardingFlow", () => {
  beforeEach(() => {
    flagState.enabled = true;
    flagState.isLoading = false;
  });

  describe("when the fork flag is still resolving", () => {
    it("holds the organization screen so a late-resolving flag cannot skip the intent screen", () => {
      flagState.enabled = false;
      flagState.isLoading = true;
      const rendered = renderHook(() => useOnboardingFlow());
      act(() => {
        rendered.result.current.setOrganizationName("Acme");
        rendered.result.current.setAgreement(true);
      });

      // Blocked while loading: advancing here would enter the pre-fork
      // flow and keep BASIC_INFO after the flag flips, bypassing INTENT.
      expect(rendered.result.current.navigation.canProceed()).toBe(false);

      // Flag resolves enabled: the user can now proceed, and the next
      // screen is INTENT — never skipped.
      flagState.enabled = true;
      flagState.isLoading = false;
      rendered.rerender();
      expect(rendered.result.current.navigation.canProceed()).toBe(true);
      act(() => {
        rendered.result.current.navigation.nextScreen();
      });
      expect(rendered.result.current.currentScreenIndex).toBe(
        OnboardingScreenIndex.INTENT,
      );
    });
  });

  describe("when the user is on the intent screen", () => {
    function advanceToIntentScreen() {
      const rendered = renderHook(() => useOnboardingFlow());
      act(() => {
        rendered.result.current.setOrganizationName("Acme");
        rendered.result.current.setAgreement(true);
      });
      act(() => {
        rendered.result.current.navigation.nextScreen();
      });
      expect(rendered.result.current.currentScreenIndex).toBe(
        OnboardingScreenIndex.INTENT,
      );
      return rendered;
    }

    /** @scenario "Intent screen is required" */
    it("blocks proceeding until an intent is selected", () => {
      const rendered = advanceToIntentScreen();
      expect(rendered.result.current.navigation.canProceed()).toBe(false);
    });

    it("allows proceeding once an intent is selected", () => {
      const rendered = advanceToIntentScreen();
      act(() => {
        rendered.result.current.setIntent("LLM_OPS");
      });
      expect(rendered.result.current.navigation.canProceed()).toBe(true);
    });
  });
});
