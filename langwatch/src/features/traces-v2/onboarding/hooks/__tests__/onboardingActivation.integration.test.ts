/**
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let mockProject: { id: string } | undefined;
let mockTourActive = false;
let mockDismissed: Record<string, boolean> = {};

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: mockProject }),
}));
vi.mock("../../store/onboardingStore", () => ({
  useOnboardingStore: (selector: (s: unknown) => unknown) =>
    selector({
      setupDismissedByProject: mockDismissed,
      tourActive: mockTourActive,
    }),
}));

import { useOnboardingActive } from "../useOnboardingActive";
import { usePreviewTracesActive } from "../usePreviewTracesActive";

describe("onboarding activation is opt-in", () => {
  beforeEach(() => {
    mockProject = { id: "p1" };
    mockTourActive = false;
    mockDismissed = {};
  });

  describe("given a never-traced project the user has not opted into", () => {
    // The hooks no longer read `hasAnyTraces` at all — a fresh, data-less
    // project must NOT auto-enter the journey or the sample-data preview.
    it("leaves the onboarding journey inactive", () => {
      const { result } = renderHook(() => useOnboardingActive());
      expect(result.current).toBe(false);
    });

    it("leaves the sample-data preview inactive", () => {
      const { result } = renderHook(() => usePreviewTracesActive());
      expect(result.current).toBe(false);
    });
  });

  describe("when the user launches the tour", () => {
    /** @scenario Taking the tour launches the onboarding journey on demand */
    it("activates both the journey and the sample-data preview", () => {
      mockTourActive = true;
      expect(renderHook(() => useOnboardingActive()).result.current).toBe(true);
      expect(renderHook(() => usePreviewTracesActive()).result.current).toBe(
        true,
      );
    });
  });

  describe("when the tour has been dismissed for this project", () => {
    it("keeps the journey inactive even if tourActive still lingers", () => {
      mockTourActive = true;
      mockDismissed = { p1: true };
      expect(renderHook(() => useOnboardingActive()).result.current).toBe(
        false,
      );
    });
  });
});
