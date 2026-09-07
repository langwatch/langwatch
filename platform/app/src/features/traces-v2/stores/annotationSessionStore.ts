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
 *
 * A comment is saved the moment it is written, so it never shows up in the
 * correction's unsaved summary and the mode bar would otherwise report "no
 * changes yet" to a reviewer who has just left five of them. Counting the
 * writes is what lets the bar say what the pass has produced without pretending
 * the comments are part of the draft: they are not, and Save and Discard must
 * keep speaking about the correction alone.
 */
export const useAnnotationSessionStore = create<AnnotationSessionState>(
  (set) => ({
    savedCount: 0,
    recordSaved: () => set((state) => ({ savedCount: state.savedCount + 1 })),
    start: () => set({ savedCount: 0 }),
  }),
);
