/**
 * @vitest-environment jsdom
 *
 * Pins the drawer-companion ride's state machine: the beats, their order,
 * and that phases advance on the ride animation's own end event rather than
 * wall-clock timers (spec: specs/langy/langy-panel-layout.feature). The
 * composite keyframes each phase drives live in langyTheme.css; what makes
 * the ride read as choreography (and not a teleport) is exactly this
 * sequencing.
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  isCompanionPlacement,
  RIDE_IN_ANIMATION,
  RIDE_OUT_ANIMATION,
  RIDE_SOLO_ANIMATION,
  useDrawerCompanionChoreography,
} from "../useDrawerCompanionChoreography";

interface HookInputs {
  isPanelOpen: boolean;
  hasDrawer: boolean;
  reduceMotion: boolean;
}

const renderChoreography = (initial: HookInputs) =>
  renderHook((inputs: HookInputs) => useDrawerCompanionChoreography(inputs), {
    initialProps: initial,
  });

describe("useDrawerCompanionChoreography", () => {
  describe("when a drawer opens beside the docked panel", () => {
    /** @scenario The companion ride is choreographed, not a teleport */
    it("rides in as one composite beat, rests, then rides out on close", () => {
      const { result, rerender } = renderChoreography({
        isPanelOpen: true,
        hasDrawer: false,
        reduceMotion: false,
      });
      expect(result.current.phase).toBe("idle");

      // The drawer opens: the panel takes the companion placement and plays
      // the composite ride-in (exit beat + shared entrance in one timeline).
      rerender({ isPanelOpen: true, hasDrawer: true, reduceMotion: false });
      expect(result.current.phase).toBe("ridingIn");
      expect(isCompanionPlacement(result.current.phase)).toBe(true);

      // The ride-in animation ends: the companion rests beside the drawer.
      act(() => result.current.onRideAnimationEnd(RIDE_IN_ANIMATION));
      expect(result.current.phase).toBe("riding");

      // The drawer closes: the pair leaves together and the panel slides
      // back into its dock, one composite timeline on the dock's geometry.
      rerender({ isPanelOpen: true, hasDrawer: false, reduceMotion: false });
      expect(result.current.phase).toBe("ridingOut");
      expect(isCompanionPlacement(result.current.phase)).toBe(false);

      act(() => result.current.onRideAnimationEnd(RIDE_OUT_ANIMATION));
      expect(result.current.phase).toBe("idle");
    });

    it("ignores foreign animation ends bubbling from children", () => {
      const { result, rerender } = renderChoreography({
        isPanelOpen: true,
        hasDrawer: false,
        reduceMotion: false,
      });
      rerender({ isPanelOpen: true, hasDrawer: true, reduceMotion: false });
      expect(result.current.phase).toBe("ridingIn");

      act(() => result.current.onRideAnimationEnd("langy-border-sheen"));
      expect(result.current.phase).toBe("ridingIn");
    });
  });

  describe("when the reader prefers reduced motion", () => {
    /** @scenario Reduced motion re-seats the companion without the ride */
    it("seats and unseats the companion with no travelling beats", () => {
      const { result, rerender } = renderChoreography({
        isPanelOpen: true,
        hasDrawer: false,
        reduceMotion: true,
      });

      rerender({ isPanelOpen: true, hasDrawer: true, reduceMotion: true });
      expect(result.current.phase).toBe("riding");

      rerender({ isPanelOpen: true, hasDrawer: false, reduceMotion: true });
      expect(result.current.phase).toBe("idle");
    });
  });

  describe("when the panel opens beside an already open drawer", () => {
    /** @scenario Opening Langy beside an already open drawer slides it in solo */
    it("enters as the companion on its own, with no exit beat", () => {
      const { result, rerender } = renderChoreography({
        isPanelOpen: false,
        hasDrawer: true,
        reduceMotion: false,
      });
      expect(result.current.phase).toBe("idle");

      rerender({ isPanelOpen: true, hasDrawer: true, reduceMotion: false });
      expect(result.current.phase).toBe("ridingSolo");
      expect(isCompanionPlacement(result.current.phase)).toBe(true);

      act(() => result.current.onRideAnimationEnd(RIDE_SOLO_ANIMATION));
      expect(result.current.phase).toBe("riding");
    });

    it("seats the companion directly when mounted mid-ride", () => {
      const { result } = renderChoreography({
        isPanelOpen: true,
        hasDrawer: true,
        reduceMotion: false,
      });
      expect(result.current.phase).toBe("riding");
    });
  });

  describe("when the panel closes mid-ride", () => {
    /** @scenario Closing Langy mid-ride returns the drawer to the edge */
    it("leaves the choreography so the panel's own close motion takes over", () => {
      const { result, rerender } = renderChoreography({
        isPanelOpen: true,
        hasDrawer: true,
        reduceMotion: false,
      });
      expect(result.current.phase).toBe("riding");

      rerender({ isPanelOpen: false, hasDrawer: true, reduceMotion: false });
      expect(result.current.phase).toBe("idle");
    });
  });
});
