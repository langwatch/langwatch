/**
 * Whether the guided tour is running, and the way to start it again.
 *
 * The tour engine owns this store; the Langy panel only reads `running` for
 * the tour card and calls `replay` from its "Show me around again" button.
 *
 * @see specs/features/onboarding/guided-tour.feature
 */
import { create } from "zustand";

interface GuidedTourState {
  running: boolean;
  /** Start the tour again from its first step. */
  replay: () => void;
  /** The tour ended, whether completed or skipped. */
  finish: () => void;
}

export const useGuidedTourStore = create<GuidedTourState>((set) => ({
  running: false,
  replay: () => set({ running: true }),
  finish: () => set({ running: false }),
}));
