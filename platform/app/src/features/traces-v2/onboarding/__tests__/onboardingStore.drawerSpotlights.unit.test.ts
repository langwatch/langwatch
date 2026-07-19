/**
 * @vitest-environment jsdom
 *
 * Unit tests for the persisted seenDrawerSpotlights map.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useOnboardingStore } from "../store/onboardingStore";

const STORAGE_KEY = "langwatch:traces-v2:onboarding:state:v1";

describe("onboardingStore drawer spotlights", () => {
  beforeEach(() => {
    localStorage.clear();
    useOnboardingStore.setState({ seenDrawerSpotlights: {} });
  });

  describe("given no drawer spotlight has been seen", () => {
    describe("when markDrawerSpotlightSeen is called", () => {
      it("flags the id in store state", () => {
        useOnboardingStore.getState().markDrawerSpotlightSeen("drawer-io");
        expect(
          useOnboardingStore.getState().seenDrawerSpotlights["drawer-io"],
        ).toBe(true);
      });

      it("persists the map to localStorage", () => {
        useOnboardingStore.getState().markDrawerSpotlightSeen("drawer-io");
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
        expect(stored.seenDrawerSpotlights).toEqual({ "drawer-io": true });
      });
    });
  });

  describe("given a drawer spotlight is already seen", () => {
    beforeEach(() => {
      useOnboardingStore.getState().markDrawerSpotlightSeen("drawer-evals");
      localStorage.clear();
    });

    describe("when markDrawerSpotlightSeen is called again with the same id", () => {
      it("does not rewrite localStorage", () => {
        useOnboardingStore.getState().markDrawerSpotlightSeen("drawer-evals");
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
      });
    });
  });

  describe("given other persisted onboarding fields exist", () => {
    describe("when a drawer spotlight is marked seen", () => {
      it("keeps the other persisted maps intact", () => {
        useOnboardingStore
          .getState()
          .setSetupDismissedForProject("proj-1", true);
        useOnboardingStore.getState().markDrawerSpotlightSeen("drawer-events");
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
        expect(stored.setupDismissedByProject).toEqual({ "proj-1": true });
        expect(stored.seenDrawerSpotlights).toEqual({ "drawer-events": true });
      });
    });
  });
});
