/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOnboardingStore } from "../../store/onboardingStore";

let isTourDismissed = false;
let isTourPreferenceResolved = true;
const mockPersistDismissal = vi.fn();

vi.mock("../useTraceExplorerTourPreference", () => ({
  useTraceExplorerTourPreference: () => ({
    dismiss: mockPersistDismissal,
    isDismissed: isTourDismissed,
    isResolved: isTourPreferenceResolved,
  }),
}));

import { useFirstTraceSpotlightTrigger } from "../useFirstTraceSpotlightTrigger";

describe("useFirstTraceSpotlightTrigger", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    isTourDismissed = false;
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

        act(() => vi.advanceTimersByTime(2_000));

        expect(useOnboardingStore.getState().spotlightsActive).toBe(false);
        expect(useOnboardingStore.getState().firstTraceSpotlightFired).toBe(
          false,
        );
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

    act(() => vi.advanceTimersByTime(2_000));

    expect(useOnboardingStore.getState().spotlightsActive).toBe(true);
    expect(useOnboardingStore.getState().firstTraceSpotlightFired).toBe(true);
  });
});
