import { create } from "zustand";

interface RefreshUIState {
  isRefreshing: boolean;
  setRefreshing: (value: boolean) => void;
  /**
   * Briefly turn the refresh spinner on so the user gets visual feedback for
   * events that don't necessarily kick a tanstack refetch (cached
   * invalidations, value-only updates, etc.). Self-clears.
   */
  pulse: (durationMs?: number) => void;
  /**
   * The trace table dims while the active query is showing previous-page
   * data after a view switch. Set true while fetching the new page.
   */
  isReplacingData: boolean;
  setReplacingData: (value: boolean) => void;
}

// Module-scoped because the timer is intentionally singleton — multiple
// rapid pulses should reset the same clear-deadline, not stack timers.
let pulseClearTimer: ReturnType<typeof setTimeout> | null = null;

export const useRefreshUIStore = create<RefreshUIState>((set) => ({
  isRefreshing: false,
  setRefreshing: (value) => set({ isRefreshing: value }),
  pulse: (durationMs = 900) => {
    if (pulseClearTimer) clearTimeout(pulseClearTimer);
    set({ isRefreshing: true });
    pulseClearTimer = setTimeout(() => {
      pulseClearTimer = null;
      set({ isRefreshing: false });
    }, durationMs);
  },
  isReplacingData: false,
  setReplacingData: (value) => set({ isReplacingData: value }),
}));
