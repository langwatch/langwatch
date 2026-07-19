/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOnboardingStore } from "../../store/onboardingStore";

let tourIsDismissed = false;
let tourPreferenceIsResolved = true;
const mockPersistDismissal = vi.fn();

vi.mock("../useTraceExplorerTourPreference", () => ({
  useTraceExplorerTourPreference: () => ({
    dismiss: mockPersistDismissal,
    isDismissed: tourIsDismissed,
    isResolved: tourPreferenceIsResolved,
  }),
}));

import { useFirstTraceSpotlightTrigger } from "../useFirstTraceSpotlightTrigger";

describe("useFirstTraceSpotlightTrigger", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    tourIsDismissed = false;
    tourPreferenceIsResolved = true;
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

  /** @scenario Dismissing the tour in one project suppresses it in another */
  it("does not auto-start for a user who dismissed the tour", () => {
    tourIsDismissed = true;

    renderHook(() =>
      useFirstTraceSpotlightTrigger({
        projectId: "another-project",
        hasAnyTraces: true,
      }),
    );

    act(() => vi.advanceTimersByTime(2_000));

    expect(useOnboardingStore.getState().spotlightsActive).toBe(false);
    expect(useOnboardingStore.getState().firstTraceSpotlightFired).toBe(false);
  });

  /** @scenario Existing browser tour history is migrated to the user preference */
  it("migrates browser tour history present when the page mounts", () => {
    useOnboardingStore.setState({ firstTraceSpotlightFired: true });

    renderHook(() =>
      useFirstTraceSpotlightTrigger({
        projectId: "current-project",
        hasAnyTraces: true,
      }),
    );

    expect(mockPersistDismissal).toHaveBeenCalledOnce();
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
