/**
 * @vitest-environment jsdom
 * @see specs/features/onboarding/guided-tour.feature
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const recordReveal = vi.fn();
const invalidateGuidedState = vi.fn();

vi.mock("../../../../behavior/onboarding-api.ts", () => ({
  onboardingApi: {
    useUtils: () => ({ onboarding: { getGuidedState: { invalidate: invalidateGuidedState } } }),
    onboarding: {
      recordVirtualKeyReveal: { useMutation: () => ({ mutateAsync: recordReveal }) },
      recordTour: { useMutation: () => ({ mutate: vi.fn() }) },
    },
  },
}));

import { onboardingGuidedTourHooks } from "../guided-tour.lend.ts";
import { getTourActions, useTourRegistry } from "../tour-registry.ts";

describe("the guided tour hooks onboarding lends", () => {
  beforeEach(() => {
    useTourRegistry.setState({ actions: {} });
    recordReveal.mockReset();
    invalidateGuidedState.mockReset();
  });

  describe("when a page outside onboarding registers an action through it", () => {
    it("lends the action to the tour while the page is mounted", () => {
      const openVirtualKeyCreate = vi.fn();
      const actions = { openVirtualKeyCreate };
      const { unmount } = renderHook(() => onboardingGuidedTourHooks.useRegisterActions(actions));
      expect(getTourActions().openVirtualKeyCreate).toBe(openVirtualKeyCreate);
      unmount();
      expect(getTourActions().openVirtualKeyCreate).toBeUndefined();
    });
  });

  describe("when the tour's key is recorded through it", () => {
    const reveal = {
      organizationId: "org_1",
      name: "production-app",
      preview: "marker-prefix",
      revealId: "reveal_1",
    };

    it("settles only after the record has answered and the guided state is refreshed", async () => {
      const order: string[] = [];
      recordReveal.mockImplementation(async () => {
        order.push("recorded");
      });
      invalidateGuidedState.mockImplementation(async () => {
        order.push("refreshed");
      });
      const { result } = renderHook(() => onboardingGuidedTourHooks.useRecordVirtualKeyReveal());

      await result.current(reveal);
      order.push("settled");

      expect(recordReveal).toHaveBeenCalledWith(reveal);
      expect(invalidateGuidedState).toHaveBeenCalledWith({ organizationId: "org_1" });
      expect(order).toEqual(["recorded", "refreshed", "settled"]);
    });

    it("rejects when the record fails, and leaves the guided state alone", async () => {
      recordReveal.mockRejectedValue(new Error("refused"));
      const { result } = renderHook(() => onboardingGuidedTourHooks.useRecordVirtualKeyReveal());

      await expect(result.current(reveal)).rejects.toThrow("refused");
      expect(invalidateGuidedState).not.toHaveBeenCalled();
    });
  });
});
