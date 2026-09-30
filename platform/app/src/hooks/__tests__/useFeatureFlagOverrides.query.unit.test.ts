/**
 * @vitest-environment jsdom
 *
 * The `?ff_<flag>=on` browser override for the guided onboarding flag: set
 * from the address bar once, remembered by this browser, and answered without
 * a network call.
 *
 * @see specs/features/onboarding/guided-onboarding-variant.feature
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyFeatureFlagOverridesFromSearch,
  clearAllFeatureFlagOverrides,
  useFeatureFlagOverrides,
} from "../useFeatureFlagOverrides";

const FLAG = "experiment_onboarding_langy_guided";

describe("given the page is opened with the guided onboarding override", () => {
  beforeEach(() => {
    clearAllFeatureFlagOverrides();
  });

  describe("when the search string is applied", () => {
    /** @scenario "the browser query override turns the guided variant on in that browser" */
    it("remembers the flag as on in this browser", () => {
      const { result } = renderHook(() => useFeatureFlagOverrides());

      act(() => {
        applyFeatureFlagOverridesFromSearch(`?ff_${FLAG}=on`);
      });

      expect(result.current[FLAG]).toBe(true);
    });

    it("clears it again with clear", () => {
      const { result } = renderHook(() => useFeatureFlagOverrides());

      act(() => {
        applyFeatureFlagOverridesFromSearch(`?ff_${FLAG}=on`);
        applyFeatureFlagOverridesFromSearch(`?ff_${FLAG}=clear`);
      });

      expect(result.current[FLAG]).toBeUndefined();
    });
  });
});
