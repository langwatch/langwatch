/**
 * @vitest-environment jsdom
 */
import { uiDeclarations } from "@langwatch/browser-host/declarations";
import { GuidedPathActiveToken } from "@langwatch/onboarding-client";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useOnboardingStore } from "../../../../../../behavior/explorer/onboarding/store/onboarding-store.ts";

let isTourDismissed = false;
let isGuidedPathActive = false;
let isOnboardingInstalled = true;
let isTourPreferenceResolved = true;
const mockPersistDismissal = vi.fn();

vi.mock("../use-trace-explorer-tour-preference.ts", () => ({
  useTraceExplorerTourPreference: () => ({
    dismiss: mockPersistDismissal,
    isDismissed: isTourDismissed,
    isResolved: isTourPreferenceResolved,
  }),
}));

const onboardingLends = uiDeclarations([
  {
    name: "onboarding",
    installation: {
      capabilities: {},
      lends: [{ token: GuidedPathActiveToken, value: { useIsActive: () => isGuidedPathActive } }],
    },
  },
]);

vi.mock("@langwatch/browser-host/capabilities", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useUiDeclarations: () => (isOnboardingInstalled ? onboardingLends : uiDeclarations([])),
}));

import { useFirstTraceSpotlightTrigger } from "../use-first-trace-spotlight-trigger.ts";

describe("useFirstTraceSpotlightTrigger", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    isTourDismissed = false;
    isGuidedPathActive = false;
    isOnboardingInstalled = true;
    isTourPreferenceResolved = true;
    mockPersistDismissal.mockReset();
    useOnboardingStore.setState({
      firstTraceSpotlightFired: false,
      spotlightsActive: false,
      currentSpotlightId: null,
      tourActive: false,
      seenDrawerSpotlights: {},
    });
    window.history.replaceState(null, "", "/traces");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given the user dismissed the tour in another project", () => {
    describe("when traces exist in the current project", () => {
      it("does not auto-start the tour", () => {
        isTourDismissed = true;

        renderHook(() =>
          useFirstTraceSpotlightTrigger({
            projectId: "another-project",
            hasAnyTraces: true,
          }),
        );

        act(() => {
          vi.advanceTimersByTime(2_000);
        });

        expect(useOnboardingStore.getState().spotlightsActive).toBe(false);
        expect(useOnboardingStore.getState().firstTraceSpotlightFired).toBe(false);
      });
    });
  });

  describe("given a guided onboarding path is active", () => {
    describe("when the first traces arrive", () => {
      /** @scenario Trace reads onboarding's guided path through its client token */
      it("stays quiet and leaves the auto-start for later", () => {
        isGuidedPathActive = true;

        renderHook(() =>
          useFirstTraceSpotlightTrigger({ projectId: "current-project", hasAnyTraces: true }),
        );

        act(() => {
          vi.advanceTimersByTime(2_000);
        });

        expect(useOnboardingStore.getState().spotlightsActive).toBe(false);
        expect(useOnboardingStore.getState().firstTraceSpotlightFired).toBe(false);
      });
    });
  });

  describe("given browser tour history exists at mount", () => {
    describe("when the trigger initializes", () => {
      it("migrates the history to the user preference", () => {
        useOnboardingStore.setState({ firstTraceSpotlightFired: true });

        renderHook(() =>
          useFirstTraceSpotlightTrigger({
            projectId: "current-project",
            hasAnyTraces: true,
          }),
        );

        expect(mockPersistDismissal).toHaveBeenCalledOnce();
      });
    });
  });

  it("does not migrate a drawer step that is first displayed after mount", () => {
    const { rerender } = renderHook(() =>
      useFirstTraceSpotlightTrigger({
        projectId: "current-project",
        hasAnyTraces: false,
      }),
    );

    act(() => {
      useOnboardingStore.setState({
        seenDrawerSpotlights: { "drawer-io": true },
      });
    });
    rerender();

    expect(mockPersistDismissal).not.toHaveBeenCalled();
  });

  it("auto-starts after the arrival delay when the user has not dismissed it", () => {
    renderHook(() =>
      useFirstTraceSpotlightTrigger({
        projectId: "current-project",
        hasAnyTraces: true,
      }),
    );

    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    expect(useOnboardingStore.getState().spotlightsActive).toBe(true);
    expect(useOnboardingStore.getState().firstTraceSpotlightFired).toBe(true);
  });

  describe("given no installed module lends the guided path token", () => {
    describe("when the first traces arrive", () => {
      /** @scenario An uninstalled onboarding leaves trace's first-trace tour free to start */
      it("reads no guided path and auto-starts the tour", () => {
        isOnboardingInstalled = false;

        renderHook(() =>
          useFirstTraceSpotlightTrigger({ projectId: "current-project", hasAnyTraces: true }),
        );

        act(() => {
          vi.advanceTimersByTime(2_000);
        });

        expect(useOnboardingStore.getState().spotlightsActive).toBe(true);
      });
    });
  });
});
