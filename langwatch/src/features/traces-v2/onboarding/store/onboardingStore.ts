import { create } from "zustand";
import {
  INITIAL_STAGE,
  type StageId,
} from "../chapters/onboardingJourneyConfig";

/**
 * Consolidated onboarding state. Combines the stage state-machine, the
 * per-project dismissal flag, the in-memory `setupDisengaged` and
 * `tourActive` overrides, and the localStorage helpers for one-time
 * decisions (density confirmed, journey completed).
 *
 * Lives in the onboarding module so the rest of the codebase doesn't
 * have to know how onboarding state is shaped — it talks to the
 * public hooks (`useOnboardingActive`, `useTourEntryPoints`,
 * `useSamplePreview`) instead. The store itself stays internal.
 *
 * Field lifecycles, for reference:
 *
 *   stage, history, arrivedAt          — ephemeral; reset on unmount
 *   setupDisengaged                     — ephemeral; per-mount
 *   tourActive                          — ephemeral; cleared on dismiss
 *   setupDismissedByProject             — persisted (localStorage)
 *   density-confirmed flag              — persisted (separate key)
 *   journey-completed flag              — persisted (separate key)
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
   * Monotonically increasing counter bumped by `replayStage()`. The
   * hero motion key incorporates this token so a "replay current"
   * action remounts the typewriter (or any other keyed effect) even
   * when the underlying stage / heading hasn't changed. The token
   * is in-memory only; reset semantics don't matter because
   * consumers only watch for a *change*.
   */
  replayToken: number;
  /**
   * Per-project persistent dismissal of the empty-state onboarding
   * card. Keyed on `projectId` so dismissing the card on Project A
   * doesn't hide it on Project B. Persisted to localStorage so a
   * reload (or a different tab on the same browser/profile) honours
   * the dismissal.
   */
  setupDismissedByProject: Record<string, boolean>;
  /**
   * "User has committed to leaving the empty-state card" — flipped
   * true the moment they click any exit action so the chrome dim
   * lifts immediately, even when the card itself is still finishing
   * its post-send countdown animation. In-memory only; reset whenever
   * the card is re-opened.
   */
  setupDisengaged: boolean;
  /**
   * Forces the empty-state journey + sample-data preview to show
   * regardless of `firstMessage`. Used by the toolbar's Tour button
   * so existing customers can opt back into the demo experience on
   * demand. In-memory only — closing the tab or hitting any dismiss
   * path clears it so we don't sticky-trap real users in the demo.
   */
  tourActive: boolean;
  /**
   * Per-project epoch-ms timestamp of when the integration CTA card
   * was dismissed. The card reappears after 14 days so users who
   * integrate later still get a reminder if they haven't sent traces
   * yet. Keyed on projectId. Persisted to localStorage.
   */
  integrationCtaDismissedAtByProject: Record<string, number>;
  /**
   * In-memory toggle for the "See sample data" toolbar button. When
   * true, sample preview traces are injected into the table alongside
   * (or instead of) real ones, with a SampleDataBanner ribbon as the
   * marker. Defaults to false. Not persisted — the toolbar button is
   * the explicit opt-in each session.
   */
  showSamplePreview: boolean;
  /**
   * Phase 2 spotlight tour — whether the contextual spotlight overlay
   * is currently rendered. Decoupled from `tourActive` (the legacy
   * journey state-machine flag, now dormant). Flipped on by the
   * "Show me around" toolbar button or by parsing `#sp=<id>` from the
   * URL fragment on mount.
   */
  spotlightsActive: boolean;
  /**
   * The id of the spotlight currently shown. Must match one of the
   * `id` fields in `TRACE_EXPLORER_SPOTLIGHTS`. When `spotlightsActive`
   * is true and this is null, the overlay starts from the first entry.
   */
  currentSpotlightId: string | null;
  /**
   * Per-project flag: has the spotlight tour been auto-started for
   * this project's first real trace yet? Flipped to true the moment
   * `hasAnyTraces` transitions false → true so the user gets a
   * contextual tour of their freshly-arrived data. Persisted so a
   * page refresh during the tour doesn't replay it from the top, and
   * so dismissing it stays dismissed.
   */
  firstTraceSpotlightFiredByProject: Record<string, boolean>;

  setStage: (stage: StageId) => void;
  goBack: () => void;
  /**
   * Replay the current beat — bumps `replayToken` to force any
   * keyed-by-token consumer (the hero `<AnimatePresence>` for the
   * typewriter, the aurora) to remount. No stage transition; the
   * journey stays where it is.
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
   * One-shot per-project: call when `hasAnyTraces` transitions
   * false → true so we can auto-start the spotlight tour on the
   * user's first real trace. Idempotent — re-calling is safe; the
   * consumer should still gate on the current map state to avoid
   * re-triggering the overlay every render.
   */
  markFirstTraceSpotlightFired: (projectId: string) => void;
}

const STORAGE_KEY = "langwatch:traces-v2:onboarding:state:v1";
/**
 * Old key from when these fields lived inside `uiStore`. Read once
 * at module init for backwards compatibility — without this, every
 * project a user previously dismissed would show the journey again.
 * Safe to leave the old key untouched: `uiStore` keeps using it for
 * its remaining persisted fields (sidebar collapsed).
 */
const LEGACY_UI_STORE_KEY = "langwatch:traces-v2:ui";

interface PersistedShape {
  setupDismissedByProject: Record<string, boolean>;
  integrationCtaDismissedAtByProject: Record<string, number>;
  firstTraceSpotlightFiredByProject: Record<string, boolean>;
}

const DEFAULT_PERSISTED: PersistedShape = {
  setupDismissedByProject: {},
  integrationCtaDismissedAtByProject: {},
  firstTraceSpotlightFiredByProject: {},
};

function loadPersisted(): PersistedShape {
  if (typeof window === "undefined") return DEFAULT_PERSISTED;
  try {
    // Prefer the new key.
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<PersistedShape>;
      if (
        parsed.setupDismissedByProject &&
        typeof parsed.setupDismissedByProject === "object"
      ) {
        return {
          setupDismissedByProject: parsed.setupDismissedByProject,
          integrationCtaDismissedAtByProject:
            parsed.integrationCtaDismissedAtByProject &&
            typeof parsed.integrationCtaDismissedAtByProject === "object"
              ? parsed.integrationCtaDismissedAtByProject
              : {},
          firstTraceSpotlightFiredByProject:
            parsed.firstTraceSpotlightFiredByProject &&
            typeof parsed.firstTraceSpotlightFiredByProject === "object"
              ? parsed.firstTraceSpotlightFiredByProject
              : {},
        };
      }
    }
    // Migrate from the old uiStore shape on first load. The old
    // shape was `{ sidebarCollapsed, setupDismissedByProject }`; we
    // pull just the dismissal map and leave sidebarCollapsed alone
    // for `uiStore` to keep using.
    const legacy = localStorage.getItem(LEGACY_UI_STORE_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy) as Partial<PersistedShape>;
      if (
        parsed.setupDismissedByProject &&
        typeof parsed.setupDismissedByProject === "object"
      ) {
        return {
          setupDismissedByProject: parsed.setupDismissedByProject,
          integrationCtaDismissedAtByProject: {},
          firstTraceSpotlightFiredByProject: {},
        };
      }
    }
  } catch {
    // storage parse failure — fall through to defaults
  }
  return DEFAULT_PERSISTED;
}

function persist({
  setupDismissedByProject,
  integrationCtaDismissedAtByProject,
  firstTraceSpotlightFiredByProject,
}: PersistedShape): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        setupDismissedByProject,
        integrationCtaDismissedAtByProject,
        firstTraceSpotlightFiredByProject,
      }),
    );
  } catch {
    // storage may be full / disabled
  }
}

const initial = loadPersisted();

export const useOnboardingStore = create<OnboardingState>((set, get) => ({
  stage: INITIAL_STAGE,
  arrivedAt: null,
  history: [],
  replayToken: 0,
  setupDismissedByProject: initial.setupDismissedByProject,
  setupDisengaged: false,
  tourActive: false,
  integrationCtaDismissedAtByProject:
    initial.integrationCtaDismissedAtByProject,
  showSamplePreview: false,
  spotlightsActive: false,
  currentSpotlightId: null,
  firstTraceSpotlightFiredByProject:
    initial.firstTraceSpotlightFiredByProject,

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
        // shouldn't re-fire the row arrivals either.
        arrivedAt: s.arrivedAt,
      };
    }),

  replayStage: () => set((s) => ({ replayToken: s.replayToken + 1 })),

  reset: () =>
    set({ stage: INITIAL_STAGE, arrivedAt: null, history: [], replayToken: 0 }),

  setSetupDismissedForProject: (projectId, dismissed) => {
    const next = { ...get().setupDismissedByProject };
    if (dismissed) {
      next[projectId] = true;
    } else {
      delete next[projectId];
    }
    set({
      setupDismissedByProject: next,
      // Re-arm engagement when un-dismissing so the dim returns next
      // time the card renders.
      ...(dismissed ? {} : { setupDisengaged: false }),
    });
    persist({
      setupDismissedByProject: next,
      integrationCtaDismissedAtByProject:
        get().integrationCtaDismissedAtByProject,
      firstTraceSpotlightFiredByProject:
        get().firstTraceSpotlightFiredByProject,
    });
  },

  setSetupDisengaged: (disengaged) => set({ setupDisengaged: disengaged }),

  setTourActive: (active) => set({ tourActive: active }),

  setIntegrationCtaDismissedAt: (projectId, ts) => {
    const next = { ...get().integrationCtaDismissedAtByProject, [projectId]: ts };
    set({ integrationCtaDismissedAtByProject: next });
    persist({
      setupDismissedByProject: get().setupDismissedByProject,
      integrationCtaDismissedAtByProject: next,
      firstTraceSpotlightFiredByProject:
        get().firstTraceSpotlightFiredByProject,
    });
  },

  clearIntegrationCtaDismissed: (projectId) => {
    const next = { ...get().integrationCtaDismissedAtByProject };
    delete next[projectId];
    set({ integrationCtaDismissedAtByProject: next });
    persist({
      setupDismissedByProject: get().setupDismissedByProject,
      integrationCtaDismissedAtByProject: next,
      firstTraceSpotlightFiredByProject:
        get().firstTraceSpotlightFiredByProject,
    });
  },

  setShowSamplePreview: (show) => set({ showSamplePreview: show }),

  setSpotlightsActive: (active) => set({ spotlightsActive: active }),
  setCurrentSpotlightId: (id) => set({ currentSpotlightId: id }),

  markFirstTraceSpotlightFired: (projectId) => {
    const current = get().firstTraceSpotlightFiredByProject;
    if (current[projectId]) return;
    const next = { ...current, [projectId]: true };
    set({ firstTraceSpotlightFiredByProject: next });
    persist({
      setupDismissedByProject: get().setupDismissedByProject,
      integrationCtaDismissedAtByProject:
        get().integrationCtaDismissedAtByProject,
      firstTraceSpotlightFiredByProject: next,
    });
  },
}));

// ---------------------------------------------------------------------------
// One-time-decision flags (separate localStorage keys; not in zustand because
// they outlive component mounts and don't need to trigger re-renders).
// ---------------------------------------------------------------------------

/**
 * Per-browser flag tracking whether the user has ever confirmed a density
 * during the onboarding journey. The first confirmation sets it; subsequent
 * journeys skip the `densityIntro` stage so the user isn't asked the same
 * one-time preference repeatedly.
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
 * Returning users get a hub of jump-to-this-bit buttons on the welcome
 * screen instead of the full linear narrative.
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
