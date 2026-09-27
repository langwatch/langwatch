/**
 * @vitest-environment jsdom
 * The `?ff_<flag>=on|off|clear` browser override: set from the address once and remembered by this browser.
 * @see specs/features/onboarding/guided-onboarding-variant.feature
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  applyFeatureFlagOverridesFromSearch,
  clearAllFeatureFlagOverrides,
  readFeatureFlagOverride,
  useFeatureFlagOverrides,
} from "../feature-flag-overrides.ts";

const FLAG = "experiment_onboarding_langy_guided";

describe("given the page is opened with a flag override in its address", () => {
  beforeEach(() => clearAllFeatureFlagOverrides());

  describe("when the search string is applied", () => {
    it("remembers the flag as on in this browser", () => {
      const { result } = renderHook(() => useFeatureFlagOverrides());

      act(() => applyFeatureFlagOverridesFromSearch(`?ff_${FLAG}=on`));

      expect(result.current[FLAG]).toBe(true);
      expect(readFeatureFlagOverride(FLAG)).toBe(true);
    });

    it("remembers off as an answer of its own", () => {
      applyFeatureFlagOverridesFromSearch(`?ff_${FLAG}=off`);

      expect(readFeatureFlagOverride(FLAG)).toBe(false);
    });

    it("returns the flag to the deployment with clear", () => {
      const { result } = renderHook(() => useFeatureFlagOverrides());

      act(() => {
        applyFeatureFlagOverridesFromSearch(`?ff_${FLAG}=on`);
        applyFeatureFlagOverridesFromSearch(`?ff_${FLAG}=clear`);
      });

      expect(result.current[FLAG]).toBeUndefined();
    });
  });

  describe("when the address names an unknown flag or value", () => {
    it("stores nothing", () => {
      applyFeatureFlagOverridesFromSearch(`?ff_not_a_real_flag=on&ff_${FLAG}=maybe`);

      expect(readFeatureFlagOverride("not_a_real_flag")).toBeUndefined();
      expect(readFeatureFlagOverride(FLAG)).toBeUndefined();
    });
  });
});
