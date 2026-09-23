/**
 * What this tab knows about each one-time reveal it has read. `claim` is the one gate, so the
 * read is spent once per tab whatever React does with the card's mounts. Deliberately not
 * persisted: a reload gets a fresh store, the server refuses the second read, the card masks.
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

export const useLangySecretRevealStore = create<LangySecretRevealState>()((set, get) => ({
  reveals: {},
  claim: (revealId) => {
    if (get().reveals[revealId]) return false;
    set((s) => ({ reveals: { ...s.reveals, [revealId]: { state: "reading" } } }));
    return true;
  },
  shown: (revealId, secret) =>
    set((s) => ({ reveals: { ...s.reveals, [revealId]: { state: "shown", secret } } })),
  gone: (revealId, error) =>
    set((s) => ({ reveals: { ...s.reveals, [revealId]: { state: "gone", error } } })),
  release: (revealId) =>
    set((s) => ({
      reveals: Object.fromEntries(Object.entries(s.reveals).filter(([id]) => id !== revealId)),
    })),
  reset: () => set({ reveals: {} }),
}));
