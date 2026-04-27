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
}));
