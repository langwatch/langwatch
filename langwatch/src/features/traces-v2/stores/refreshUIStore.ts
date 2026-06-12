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
  /**
   * True between an explicit `refresh()` call (refresh button, "N new"
   * pill acknowledge, tab-return refresh) and that refetch settling.
   * The aurora ribbon keys off this so background refetches — SSE
   * invalidations when a span arrives or a trace updates — don't play
   * the full arrival animation; those get the subtle per-row pulse
   * instead.
   */
  refreshRequested: boolean;
  /** Internal latch: an in-flight fetch has been observed since the
   * request, so the next not-fetching observation means "settled". */
  refreshSawFetch: boolean;
  /** Mark an explicit, user-initiated refresh. */
  requestRefresh: () => void;
  /**
   * Feed the live isFetching signal into the request lifecycle. The
   * request only clears after a fetch has been SEEN and then ended —
   * covering the gap between `requestRefresh()` and React Query
   * actually flipping isFetching, where clearing early would kill the
   * aurora before it started.
   */
  observeFetching: (fetching: boolean) => void;
}

// Module-scoped because the timer is intentionally singleton — multiple
// rapid pulses should reset the same clear-deadline, not stack timers.
let pulseClearTimer: ReturnType<typeof setTimeout> | null = null;

// Safety valve for the refresh-request latch: if no observable fetch ever
// follows a requestRefresh() (queries unmounted, navigation away), clear the
// request after this long so the aurora can't stick on forever.
const REFRESH_REQUEST_TIMEOUT_MS = 15_000;
let refreshRequestTimer: ReturnType<typeof setTimeout> | null = null;

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
  refreshRequested: false,
  refreshSawFetch: false,
  requestRefresh: () => {
    if (refreshRequestTimer) clearTimeout(refreshRequestTimer);
    set({ refreshRequested: true, refreshSawFetch: false });
    refreshRequestTimer = setTimeout(() => {
      refreshRequestTimer = null;
      set((s) =>
        s.refreshRequested
          ? { refreshRequested: false, refreshSawFetch: false }
          : s,
      );
    }, REFRESH_REQUEST_TIMEOUT_MS);
  },
  observeFetching: (fetching) =>
    set((s) => {
      if (!s.refreshRequested) return s;
      if (fetching) return { refreshSawFetch: true };
      if (s.refreshSawFetch) {
        if (refreshRequestTimer) {
          clearTimeout(refreshRequestTimer);
          refreshRequestTimer = null;
        }
        return { refreshRequested: false, refreshSawFetch: false };
      }
      return s;
    }),
}));
