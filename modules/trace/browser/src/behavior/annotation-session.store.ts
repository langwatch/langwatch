import { create } from "zustand";

interface AnnotationSessionState {
  /** Comments written since the counter was last started. */
  savedCount: number;
  /** Records one comment written. Called wherever a comment is created. */
  recordSaved: () => void;
  /** Starts a fresh count, for a pass that is only beginning now. */
  start: () => void;
}

/**
 * How many comments the reviewer has written in the pass they are in.
 */
export const useAnnotationSessionStore = create<AnnotationSessionState>((set) => ({
  savedCount: 0,
  recordSaved: () => set((state) => ({ savedCount: state.savedCount + 1 })),
  start: () => set({ savedCount: 0 }),
}));
