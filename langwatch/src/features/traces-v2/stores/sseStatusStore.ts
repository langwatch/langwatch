import { create } from "zustand";
import type { ConnectionState } from "~/hooks/useSSESubscription";

interface SseStatusState {
  sseConnectionState: ConnectionState;
  setSseConnectionState: (state: ConnectionState) => void;
  lastEventAt: number;
  setLastEventAt: (ts: number) => void;
  /**
   * Bumped whenever an SSE event signals fresh data is available, so polling
   * fallbacks can reset back to their fast cadence.
   */
  fastPollRequestedAt: number;
  requestFastPoll: () => void;
}

export const useSseStatusStore = create<SseStatusState>((set) => ({
  sseConnectionState: "connecting",
  setSseConnectionState: (state) => set({ sseConnectionState: state }),
  lastEventAt: 0,
  setLastEventAt: (ts) => set({ lastEventAt: ts }),
  fastPollRequestedAt: 0,
  requestFastPoll: () => set({ fastPollRequestedAt: Date.now() }),
}));
