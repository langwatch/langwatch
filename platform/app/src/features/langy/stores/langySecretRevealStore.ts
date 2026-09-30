/**
 * What this browser tab knows about each one-time reveal it has read.
 *
 * A reveal serves its secret once, so the card that reads it must read it
 * exactly once per tab, whatever React does with its mounts: the transcript
 * re-renders while a turn streams, the card can unmount and mount again in
 * the same conversation, and a second card for the same call must not spend
 * the read. `claim` is the one gate: the first caller gets to read, every
 * later one reads the outcome from here.
 *
 * Deliberately not persisted. A reload gets a fresh store, the server refuses
 * the second read, and the card masks: that is the whole promise of "shown
 * once". Nothing here is written anywhere but memory.
 */
import { create } from "zustand";

export type LangySecretRevealEntry =
  | { state: "reading" }
  | { state: "shown"; secret: string }
  | { state: "gone"; error: unknown };

interface LangySecretRevealState {
  reveals: Record<string, LangySecretRevealEntry>;
  /** Take the one read of `revealId`. True for the first caller only. */
  claim: (revealId: string) => boolean;
  shown: (revealId: string, secret: string) => void;
  gone: (revealId: string, error: unknown) => void;
  /** Let a failed read (not a refusal) be tried again. */
  release: (revealId: string) => void;
  /** For tests: forget every reveal. */
  reset: () => void;
}

export const useLangySecretRevealStore = create<LangySecretRevealState>()(
  (set, get) => ({
    reveals: {},
    claim: (revealId) => {
      if (get().reveals[revealId]) return false;
      set((s) => ({
        reveals: { ...s.reveals, [revealId]: { state: "reading" } },
      }));
      return true;
    },
    shown: (revealId, secret) =>
      set((s) => ({
        reveals: { ...s.reveals, [revealId]: { state: "shown", secret } },
      })),
    gone: (revealId, error) =>
      set((s) => ({
        reveals: { ...s.reveals, [revealId]: { state: "gone", error } },
      })),
    release: (revealId) =>
      set((s) => {
        const { [revealId]: _dropped, ...rest } = s.reveals;
        return { reveals: rest };
      }),
    reset: () => set({ reveals: {} }),
  }),
);
