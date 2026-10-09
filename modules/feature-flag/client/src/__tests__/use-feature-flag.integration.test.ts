/**
 * @vitest-environment jsdom
 *
 * A flag read from the frontend: this browser's `?ff_` answer wins, never asked of the server.
 * @see specs/features/onboarding/guided-onboarding-variant.feature
 */
import { FrontendFlags } from "@langwatch/feature-flag-contract";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyFeatureFlagOverridesFromSearch,
  clearAllFeatureFlagOverrides,
} from "../feature-flag-overrides.ts";
import { useFeatureFlag } from "../use-feature-flag.ts";

const reads = vi.hoisted(() => ({ enabled: [] as boolean[] }));

vi.mock("../feature-flag-client.ts", () => ({
  CLIENT_FLAG_STALE_TIME_MS: 0,
  featureFlagClient: {
    featureFlag: {
      isEnabled: {
        useQuery: (_input: unknown, options: { enabled: boolean }) => {
          reads.enabled.push(options.enabled);
          return { data: options.enabled ? { enabled: false } : undefined, isLoading: false };
        },
      },
    },
  },
}));

afterEach(() => {
  cleanup();
  clearAllFeatureFlagOverrides();
  reads.enabled.length = 0;
});

const FLAG = FrontendFlags.experiment_onboarding_langy_guided;

describe("given the page is opened with the guided variant's query override", () => {
  describe("when the flag is read from the frontend", () => {
    /** @scenario "the browser query override turns the guided variant on in that browser" */
    it("resolves to true without a network call", () => {
      act(() => applyFeatureFlagOverridesFromSearch(`?ff_${FLAG.name}=on`));

      const { result } = renderHook(() =>
        useFeatureFlag(FLAG, { projectId: "project-1", organizationId: "org-1" }),
      );

      expect(result.current).toEqual({ enabled: true, isLoading: false });
      expect(reads.enabled).not.toContain(true);
    });
  });
});

describe("given no override in this browser", () => {
  describe("when the flag is read from the frontend", () => {
    it("asks the server", () => {
      const { result } = renderHook(() =>
        useFeatureFlag(FLAG, { projectId: "project-1", organizationId: "org-1" }),
      );

      expect(result.current.enabled).toBe(false);
      expect(reads.enabled).toContain(true);
    });
  });
});
