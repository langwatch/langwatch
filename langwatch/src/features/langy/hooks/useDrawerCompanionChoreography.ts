import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Where the panel is in the drawer-companion ride
 * (spec: specs/langy/langy-panel-layout.feature).
 *
 *   idle        – no drawer influence; the ordinary dock / floating placement
 *   ridingIn    – companion placement, playing the COMPOSITE ride-in: slide
 *                 off the right edge, then enter with the drawer as one unit
 *   ridingSolo  – companion placement, sliding in on its own (the panel
 *                 opened beside an already open drawer)
 *   riding      – companion placement, at rest beside the drawer
 *   ridingOut   – back on the dock's geometry, playing the composite
 *                 ride-out: leave with the drawer, then slide into the dock
 *
 * WHY composite one-animation beats: the ride reads as choreography only if
 * the panel and the drawer move as one rigid unit, and two CSS animations
 * are only guaranteed a shared start time when they are created in the SAME
 * commit (the drawer mounts hefty content, and an animation created later —
 * by a timer — start-pends behind that hydration and trails visibly). So
 * each side gets exactly one animation per ride, created together: the
 * drawer delays its entrance inside its own animation, and the panel folds
 * its exit beat and its shared beat into one keyframe timeline.
 *
 * Phases advance on the animation's own `animationend` (no wall-clock
 * timers), and every phase's resting style equals the next phase's, so a
 * lost event degrades to correct visuals rather than a stuck ride.
 */
export type CompanionPhase =
  | "idle"
  | "ridingIn"
  | "ridingSolo"
  | "riding"
  | "ridingOut";

const COMPANION_PLACEMENT_PHASES: CompanionPhase[] = [
  "ridingIn",
  "ridingSolo",
  "riding",
];

export const isCompanionPlacement = (phase: CompanionPhase): boolean =>
  COMPANION_PLACEMENT_PHASES.includes(phase);

/** The ride animations' names, matched on animationend. langyTheme.css. */
export const RIDE_IN_ANIMATION = "langy-companion-ride-in";
export const RIDE_SOLO_ANIMATION = "langy-slide-in-right";
export const RIDE_OUT_ANIMATION = "langy-companion-ride-out";

interface UseDrawerCompanionChoreographyArgs {
  /** The Langy panel's own open state. */
  isPanelOpen: boolean;
  /** Whether any right-anchored drawer is open. */
  hasDrawer: boolean;
  /** Reduced motion re-seats directly: no travelling beats. */
  reduceMotion: boolean;
}

export function useDrawerCompanionChoreography({
  isPanelOpen,
  hasDrawer,
  reduceMotion,
}: UseDrawerCompanionChoreographyArgs): {
  phase: CompanionPhase;
  /** Wire to the panel's animationend; advances ride phases to rest. */
  onRideAnimationEnd: (animationName: string) => void;
} {
  const [phase, setPhase] = useState<CompanionPhase>(() =>
    // Mounted mid-ride (a project switch remounts the panel): seat the
    // companion directly, there is no dock position to animate from.
    isPanelOpen && hasDrawer ? "riding" : "idle",
  );
  const previous = useRef({ isPanelOpen, hasDrawer });

  useEffect(() => {
    const was = previous.current;
    previous.current = { isPanelOpen, hasDrawer };

    // A closed panel is out of the choreography entirely — its own
    // open/close motion takes over (and the drawer, live-keyed on the
    // panel's open state, stops yielding).
    if (!isPanelOpen) {
      setPhase("idle");
      return;
    }

    if (hasDrawer && !was.hasDrawer) {
      // A drawer just opened beside the open panel: the full ride, unless
      // motion is off or the panel opened this very tick (no dock on
      // screen to slide out of).
      setPhase(
        reduceMotion ? "riding" : was.isPanelOpen ? "ridingIn" : "ridingSolo",
      );
      return;
    }

    if (hasDrawer && !was.isPanelOpen) {
      // The panel opened INTO an existing drawer: no dock to leave —
      // slide the companion in on its own.
      setPhase(reduceMotion ? "riding" : "ridingSolo");
      return;
    }

    if (!hasDrawer && was.hasDrawer) {
      // The drawer just closed: leave together, then slide back into the
      // dock — all one animation on the dock's own geometry.
      setPhase(reduceMotion ? "idle" : "ridingOut");
    }
  }, [isPanelOpen, hasDrawer, reduceMotion]);

  const onRideAnimationEnd = useCallback((animationName: string) => {
    if (
      animationName === RIDE_IN_ANIMATION ||
      animationName === RIDE_SOLO_ANIMATION
    ) {
      setPhase((current) =>
        current === "ridingIn" || current === "ridingSolo" ? "riding" : current,
      );
      return;
    }
    if (animationName === RIDE_OUT_ANIMATION) {
      setPhase((current) => (current === "ridingOut" ? "idle" : current));
    }
  }, []);

  return { phase, onRideAnimationEnd };
}
