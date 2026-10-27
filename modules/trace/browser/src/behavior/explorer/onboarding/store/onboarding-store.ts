import { defineSlice } from "@langwatch/browser-host/global-store";
import { nowInstant } from "@langwatch/time";

import {
  INITIAL_STAGE,
  type StageId,
} from "../../../../model/explorer/onboarding/chapters/onboarding-journey-config.ts";

/**
 * Consolidated onboarding state. Combines the stage state-machine, the per-project
 * dismissal flag, the in-memory `setupDisengaged` and `tourActive` overrides, and the
 * one-time decisions persisted for the reader (§10.2).
 */

interface OnboardingState {
  stage: StageId;
  /**
   * Wallclock millis when the stage first hit `auroraArrival`.
   * Drives any time-based UI; mostly used as a "have we passed
   * arrival yet?" timestamp.
   */
  arrivedAt: number | null;
  /**
   * Stack of stages we've moved through during this mount, oldest
   * → newest. `goBack()` pops one and restores it as the current
   * stage so the user can re-read a beat they whizzed past.
   */
  history: StageId[];
  /**
   * Monotonically increasing counter bumped by `replayStage()`. The hero motion key
   * incorporates this token so a "replay current" action remounts the typewriter (or
   * any other keyed effect) even when the underlying stage / heading hasn't changed.
   */
  replayToken: number;
  /**
   * Per-project persistent dismissal of the empty-state onboarding card. Keyed on
   * `projectId` so dismissing the card on Project A doesn't hide it on Project B.
   */
  setupDismissedByProject: Record<string, boolean>;
  /**
   * "User has committed to leaving the empty-state card" — flipped true the moment they
   * click any exit action so the chrome dim lifts immediately, even when the card
   * itself is still finishing its post-send countdown animation.
   */
  setupDisengaged: boolean;
  /**
   * Forces the empty-state journey + sample-data preview to show regardless of
   * `firstMessage`. Used by the toolbar's Tour button so existing customers can opt
   * back into the demo experience on demand.
   */
  tourActive: boolean;
  /**
   * Per-project epoch-ms timestamp of when the integration CTA card was dismissed. The
   * card reappears after 14 days so users who integrate later still get a reminder if
   * they haven't sent traces yet. Keyed on projectId. Persisted for the reader.
   */
  integrationCtaDismissedAtByProject: Record<string, number>;
  /**
   * In-memory toggle for the "See sample data" toolbar button. When true, sample
   * preview traces are injected into the table alongside (or instead of) real ones,
   * with a SampleDataBanner ribbon as the marker. Defaults to false.
   */
  showSamplePreview: boolean;
  /**
   * Phase 2 spotlight tour — whether the contextual spotlight overlay is currently
   * rendered. Decoupled from `tourActive` (the legacy journey state-machine flag, now
   * dormant).
   */
  spotlightsActive: boolean;
  /**
   * The id of the spotlight currently shown. Must match one of the
   * `id` fields in `TRACE_EXPLORER_SPOTLIGHTS`. When `spotlightsActive`
   * is true and this is null, the overlay starts from the first entry.
   */
  currentSpotlightId: string | null;
  /**
   * Browser-level guard against starting the automatic first-trace tour more than once
   * in the same profile. The server-backed user preference is the authoritative
   * dismissal across projects, browsers, and devices.
   */
  firstTraceSpotlightFired: boolean;
  /**
   * Browser-level map of drawer spotlight ids already displayed. This
   * preserves step-level show-once behavior locally, while the server-backed
   * preference suppresses the full automatic queue after dismissal.
   */
  seenDrawerSpotlights: Record<string, boolean>;

  setStage: (stage: StageId) => void;
  goBack: () => void;
  /**
   * Replay the current beat — bumps `replayToken` to force any keyed-by-token consumer
   * (the hero `<AnimatePresence>` for the typewriter, the aurora) to remount. No stage
   * transition; the journey stays where it is.
   */
  replayStage: () => void;
  reset: () => void;
  setSetupDismissedForProject: (projectId: string, dismissed: boolean) => void;
  setSetupDisengaged: (disengaged: boolean) => void;
  setTourActive: (active: boolean) => void;
  setIntegrationCtaDismissedAt: (projectId: string, ts: number) => void;
  clearIntegrationCtaDismissed: (projectId: string) => void;
  setShowSamplePreview: (show: boolean) => void;
  setSpotlightsActive: (active: boolean) => void;
  setCurrentSpotlightId: (id: string | null) => void;
  /**
   * One-shot global: call when `hasAnyTraces` transitions false → true so we can
   * auto-start the spotlight tour on the browser's first real trace.
   */
  markFirstTraceSpotlightFired: () => void;
  /**
   * Mark a drawer spotlight as displayed. Idempotent; persists for
   * the reader so the show-once guarantee survives reloads.
   */
  markDrawerSpotlightSeen: (id: string) => void;
}

function transitionStage(
  state: OnboardingState,
  stage: StageId,
): OnboardingState | Pick<OnboardingState, "stage" | "history" | "arrivedAt"> {
  if (stage === state.stage) return state;

  const arrivedAt =
    stage === "auroraArrival" && state.stage !== "auroraArrival"
      ? nowInstant().epochMilliseconds
      : state.arrivedAt;

  return {
    stage,
    history: [...state.history, state.stage],
    arrivedAt,
  };
}

export const useOnboardingStore = defineSlice<OnboardingState>({
  name: "trace:onboarding",
  create: (set, get) => ({
    stage: INITIAL_STAGE,
    arrivedAt: null,
    history: [],
    replayToken: 0,
    setupDismissedByProject: {},
    setupDisengaged: false,
    tourActive: false,
    integrationCtaDismissedAtByProject: {},
    showSamplePreview: false,
    spotlightsActive: false,
    currentSpotlightId: null,
    firstTraceSpotlightFired: false,
    seenDrawerSpotlights: {},

    setStage: (stage) => set((state) => transitionStage(state, stage)),

    goBack: () =>
      set((s) => {
        const previous = s.history[s.history.length - 1];
        if (!previous) return s;
        // `arrivedAt` stays: once aurora has fired, going back must not re-fire it.
        return { stage: previous, history: s.history.slice(0, -1), arrivedAt: s.arrivedAt };
      }),

    replayStage: () => set((s) => ({ replayToken: s.replayToken + 1 })),

    reset: () => set({ stage: INITIAL_STAGE, arrivedAt: null, history: [], replayToken: 0 }),

    setSetupDismissedForProject: (projectId, dismissed) => {
      const next = { ...get().setupDismissedByProject };
      if (dismissed) {
        next[projectId] = true;
      } else {
        delete next[projectId];
      }
      // Re-arm engagement when un-dismissing so the dim returns next time the card renders.
      set({ setupDismissedByProject: next, ...(dismissed ? {} : { setupDisengaged: false }) });
    },

    setSetupDisengaged: (disengaged) => set({ setupDisengaged: disengaged }),

    setTourActive: (active) => set({ tourActive: active }),

    setIntegrationCtaDismissedAt: (projectId, ts) =>
      set((s) => ({
        integrationCtaDismissedAtByProject: {
          ...s.integrationCtaDismissedAtByProject,
          [projectId]: ts,
        },
      })),

    clearIntegrationCtaDismissed: (projectId) => {
      const next = { ...get().integrationCtaDismissedAtByProject };
      delete next[projectId];
      set({ integrationCtaDismissedAtByProject: next });
    },

    setShowSamplePreview: (show) => set({ showSamplePreview: show }),

    setSpotlightsActive: (active) => set({ spotlightsActive: active }),
    setCurrentSpotlightId: (id) => set({ currentSpotlightId: id }),

    markFirstTraceSpotlightFired: () => {
      if (get().firstTraceSpotlightFired) return;
      set({ firstTraceSpotlightFired: true });
    },

    markDrawerSpotlightSeen: (id) => {
      const current = get().seenDrawerSpotlights;
      if (current[id]) return;
      set({ seenDrawerSpotlights: { ...current, [id]: true } });
    },
  }),
  persist: {
    partialize: ({
      setupDismissedByProject,
      integrationCtaDismissedAtByProject,
      firstTraceSpotlightFired,
      seenDrawerSpotlights,
    }) => ({
      setupDismissedByProject,
      integrationCtaDismissedAtByProject,
      firstTraceSpotlightFired,
      seenDrawerSpotlights,
    }),
  },
});

// ---------------------------------------------------------------------------
// One-time-decision flags (separate localStorage keys; not in zustand because
// they outlive component mounts and don't need to trigger re-renders).
// ---------------------------------------------------------------------------

/**
 * Per-browser flag tracking whether the user has ever confirmed a density during the
 * onboarding journey. The first confirmation sets it; subsequent journeys skip the
 * `densityIntro` stage so the user isn't asked the same one-time preference repeatedly.
 */
const DENSITY_CONFIRMED_KEY = "langwatch:traces-v2:onboarding:density-confirmed:v1";

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
    return;
  }
}

/**
 * Per-browser flag tracking whether the user has reached the end of the empty-state
 * journey at least once (set when the journey hits `outro`).
 */
const JOURNEY_COMPLETED_KEY = "langwatch:traces-v2:onboarding:journey-completed:v1";

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
    return;
  }
}
