/**
 * Where the guided tour is right now: which path, which step, whether the
 * spotlight is handing the screen over to the panel. A module store, like
 * the Langy store, so the host that starts the tour, the layer that plays
 * it, the Home offer that hides while it runs and the panel card that
 * replays it all read the same run without threading props.
 *
 * The run's end callback is what makes the first run different from a
 * replay: the first run queues the Langy kickoff when it ends, a replay
 * queues nothing.
 *
 * @see specs/features/onboarding/guided-tour.feature
 */
import { create } from "zustand";
import type { GuidedPath } from "../paths";
import { TOUR_STEPS } from "./tourSteps";

export type TourEndStatus = "completed" | "skipped";
export type TourHandoff = "lit" | "fading" | null;

interface GuidedTourState {
  running: boolean;
  path: GuidedPath | null;
  stepIndex: number;
  handoff: TourHandoff;
  /** Bumped on every start or replay, so the layer restarts from step 1. */
  runId: number;
  /** Called once when the run ends; null for a replay. */
  onEnd: ((status: TourEndStatus) => void) | null;

  /** Runs `path`'s tour from step 1. A path with no steps ends at once. */
  start: (
    path: GuidedPath,
    options?: { onEnd?: (status: TourEndStatus) => void },
  ) => void;
  /**
   * Runs a tour again from step 1, queueing nothing at the end: `path`'s,
   * or the last one run when none is named. The card names the path, so a
   * replay works after a reload, when this store has run nothing yet.
   */
  replay: (path?: GuidedPath) => void;
  goToStep: (index: number) => void;
  /** Ends the run: the layer takes over with the handoff animation. */
  end: (status: TourEndStatus) => void;
  setHandoff: (handoff: TourHandoff) => void;
}

export const useGuidedTourStore = create<GuidedTourState>()((set, get) => ({
  running: false,
  path: null,
  stepIndex: 0,
  handoff: null,
  runId: 0,
  onEnd: null,

  start: (path, options) => {
    const onEnd = options?.onEnd ?? null;
    if (TOUR_STEPS[path].length === 0) {
      set({ running: false, path, stepIndex: 0, onEnd: null });
      onEnd?.("completed");
      return;
    }
    set((state) => ({
      running: true,
      path,
      stepIndex: 0,
      handoff: null,
      runId: state.runId + 1,
      onEnd,
    }));
  },

  replay: (wanted) => {
    const path = wanted ?? get().path;
    if (!path || TOUR_STEPS[path].length === 0) return;
    set((state) => ({
      running: true,
      path,
      stepIndex: 0,
      handoff: null,
      runId: state.runId + 1,
      onEnd: null,
    }));
  },

  goToStep: (index) => {
    const { path, running } = get();
    if (!running || !path) return;
    const count = TOUR_STEPS[path].length;
    if (index < 0 || index >= count) return;
    set({ stepIndex: index });
  },

  end: (status) => {
    const { running, onEnd } = get();
    if (!running) return;
    set({ running: false, onEnd: null });
    onEnd?.(status);
  },

  setHandoff: (handoff) => set({ handoff }),
}));
