import { create } from "zustand";
import type { ConnectionState } from "~/hooks/useSSESubscription";

interface FreshnessSignal {
  fastPollRequestedAt: number;
  requestFastPoll: () => void;
  sseConnectionState: ConnectionState;
  setSseConnectionState: (state: ConnectionState) => void;
  lastEventAt: number;
  setLastEventAt: (ts: number) => void;
  refresh: (() => void) | null;
  setRefresh: (fn: () => void) => void;
  isRefreshing: boolean;
  setRefreshing: (value: boolean) => void;
  isReplacingData: boolean;
  setReplacingData: (value: boolean) => void;
  /**
   * One-shot flag set by the welcome flow before triggering refresh, consumed
   * by `RefreshProgressBar` on mount to play the dramatic 3x-tall swell entrance
   * only after Dive in. Cleared after one use so subsequent refreshes use the
   * mild fade.
   */
  welcomeBoom: boolean;
  setWelcomeBoom: (value: boolean) => void;
}

export const useFreshnessSignal = create<FreshnessSignal>((set) => ({
  fastPollRequestedAt: 0,
  requestFastPoll: () => set({ fastPollRequestedAt: Date.now() }),
  sseConnectionState: "connecting",
  setSseConnectionState: (state) => set({ sseConnectionState: state }),
  lastEventAt: 0,
  setLastEventAt: (ts) => set({ lastEventAt: ts }),
  refresh: null,
  setRefresh: (fn) => set({ refresh: fn }),
  isRefreshing: false,
  setRefreshing: (value) => set({ isRefreshing: value }),
  isReplacingData: false,
  setReplacingData: (value) => set({ isReplacingData: value }),
  welcomeBoom: false,
  setWelcomeBoom: (value) => set({ welcomeBoom: value }),
}));
