import { create } from "zustand";
import {
  INITIAL_STAGE,
  type StageId,
} from "../components/EmptyState/onboardingJourneyConfig";

/**
 * The empty-state onboarding journey is a small state machine that
 * stages teaching moments over time. Stage definitions (copy,
 * timings, transitions, side effects like aurora visibility) live
 * in `onboardingJourneyConfig.ts` — this store just holds *which*
 * stage we're in and lets components advance it.
 *
 * Mounted exactly once per project + visit; the journey resets on
 * unmount which matches user expectation ("show me again if I come
 * back via Restart intro").
 */
interface OnboardingStageState {
  stage: StageId;
  /**
   * Wallclock millis when the stage first hit `auroraArrival`.
   * Drives any time-based UI (the existing AuroraSvg keeps drifting
   * on its own, so we mostly just use this as a "have we passed
   * arrival yet" timestamp).
   */
  arrivedAt: number | null;
  /**
   * Stack of stages we've moved through during this mount, oldest
   * → newest. `goBack()` pops one and restores it as the current
   * stage so the user can re-read a beat they whizzed past.
   */
  history: StageId[];
  setStage: (stage: StageId) => void;
  goBack: () => void;
  reset: () => void;
}

export const useOnboardingStageStore = create<OnboardingStageState>((set) => ({
  stage: INITIAL_STAGE,
  arrivedAt: null,
  history: [],
  setStage: (stage) =>
    set((s) =>
      stage === s.stage
        ? s
        : {
            stage,
            history: [...s.history, s.stage],
            arrivedAt:
              stage === "auroraArrival" && s.stage !== "auroraArrival"
                ? Date.now()
                : s.arrivedAt,
          },
    ),
  goBack: () =>
    set((s) => {
      const previous = s.history[s.history.length - 1];
      if (!previous) return s;
      return {
        stage: previous,
        history: s.history.slice(0, -1),
        // Don't clear `arrivedAt` — once aurora has fired we never
        // un-fire it; going back from postArrival to auroraArrival
        // shouldn't reset the row arrivals either (`shouldShowArrivals`
        // continues to gate them by stage, not timestamp).
        arrivedAt: s.arrivedAt,
      };
    }),
  reset: () => set({ stage: INITIAL_STAGE, arrivedAt: null, history: [] }),
}));

/**
 * Per-browser flag tracking whether the user has ever confirmed
 * a density during the onboarding journey. The first confirmation
 * sets it; subsequent journeys (Restart intro, navigating away
 * and back, etc.) skip the `densityIntro` stage entirely so the
 * user isn't asked the same one-time preference over and over.
 */
const DENSITY_CONFIRMED_KEY =
  "langwatch:traces-v2:onboarding:density-confirmed:v1";

export function hasDensityBeenConfirmed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(DENSITY_CONFIRMED_KEY) === "true";
  } catch {
    return false;
  }
}

export function markDensityConfirmed(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(DENSITY_CONFIRMED_KEY, "true");
  } catch {
    // storage may be full / disabled
  }
}

/**
 * Per-browser flag tracking whether the user has reached the end of the
 * empty-state journey at least once (set when the journey hits `outro`).
 * Returning users who re-enter the empty state — typically via the
 * toolbar's "SDK connection pending" button after dismissing — get a
 * different welcome screen: a small hub of jump-to-this-bit buttons
 * instead of the full linear narrative they've already sat through.
 *
 * We persist in localStorage rather than zustand so the flag survives
 * unmounts (the journey resets on unmount, which is desired) and full
 * reloads.
 */
const JOURNEY_COMPLETED_KEY =
  "langwatch:traces-v2:onboarding:journey-completed:v1";

export function hasCompletedJourney(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(JOURNEY_COMPLETED_KEY) === "true";
  } catch {
    return false;
  }
}

export function markJourneyCompleted(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(JOURNEY_COMPLETED_KEY, "true");
  } catch {
    // storage may be full / disabled
  }
}
