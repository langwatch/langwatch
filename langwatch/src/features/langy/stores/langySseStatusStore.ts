import { create } from "zustand";
import type { ConnectionState } from "~/hooks/useSSESubscription";

/**
 * SSE + adaptive-poll status for the Langy panel, mirroring
 * `traces-v2/stores/sseStatusStore`.
 *
 * SSE is the primary freshness signal: when connected, the freshness
 * coordinator applies pushed operational spine in place (or invalidates), so
 * the new-count query does NOT poll. Polling is a fallback only for when SSE is
 * unavailable (connecting / disconnected / error), and it backs off as
 * consecutive polls come back empty.
 *
 * Langy is intentionally simpler than the traces table: it has no
 * live/ask/paused preference — a chat panel is always live — so this store
 * holds only connection state, the last-event timestamp, and the fast-poll
 * reset signal.
 */
interface LangySseStatusState {
  sseConnectionState: ConnectionState;
  setSseConnectionState: (state: ConnectionState) => void;
  lastEventAt: number;
  setLastEventAt: (ts: number) => void;
  /**
   * Bumped whenever an SSE event signals fresh data is available, so the
   * poll fallback can reset to its fast cadence.
   */
  fastPollRequestedAt: number;
  requestFastPoll: () => void;
}

export const useLangySseStatusStore = create<LangySseStatusState>((set) => ({
  sseConnectionState: "connecting",
  setSseConnectionState: (state) => set({ sseConnectionState: state }),
  lastEventAt: 0,
  setLastEventAt: (ts) => set({ lastEventAt: ts }),
  fastPollRequestedAt: 0,
  requestFastPoll: () => set({ fastPollRequestedAt: Date.now() }),
}));
