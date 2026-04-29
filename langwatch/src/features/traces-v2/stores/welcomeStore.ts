import { create } from "zustand";

interface WelcomeState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  /**
   * One-shot flag set by the welcome flow before triggering refresh, consumed
   * by `RefreshProgressBar` on mount to play the dramatic 3x-tall swell entrance
   * only after Dive in. Cleared after one use so subsequent refreshes use the
   * mild fade.
   */
  welcomeBoom: boolean;
  setWelcomeBoom: (value: boolean) => void;
}

export const useWelcomeStore = create<WelcomeState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  welcomeBoom: false,
  setWelcomeBoom: (value) => set({ welcomeBoom: value }),
}));
