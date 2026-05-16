import { create } from "zustand";
import type { ConnectionState } from "~/hooks/useSSESubscription";

const LIVE_UPDATES_STORAGE_KEY =
  "langwatch:traces-v2:live-updates-enabled:v1";

function readLiveUpdatesPref(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(LIVE_UPDATES_STORAGE_KEY);
    if (raw === null) return true;
    return raw !== "false";
  } catch {
    return true;
  }
}

function persistLiveUpdatesPref(value: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LIVE_UPDATES_STORAGE_KEY, String(value));
  } catch {
    // Best-effort persistence.
  }
}

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
  /**
   * Operator preference for whether the SSE subscription is active.
   * Persists to localStorage so the choice survives reloads. When false,
   * the subscription hook short-circuits and the connection-state is
   * forced to `"disconnected"` so the indicator reads correctly.
   */
  liveUpdatesEnabled: boolean;
  setLiveUpdatesEnabled: (value: boolean) => void;
  toggleLiveUpdates: () => void;
}

export const useSseStatusStore = create<SseStatusState>((set, get) => ({
  sseConnectionState: "connecting",
  setSseConnectionState: (state) => set({ sseConnectionState: state }),
  lastEventAt: 0,
  setLastEventAt: (ts) => set({ lastEventAt: ts }),
  fastPollRequestedAt: 0,
  requestFastPoll: () => set({ fastPollRequestedAt: Date.now() }),
  liveUpdatesEnabled: readLiveUpdatesPref(),
  setLiveUpdatesEnabled: (value) => {
    persistLiveUpdatesPref(value);
    set({
      liveUpdatesEnabled: value,
      sseConnectionState: value ? "connecting" : "disconnected",
    });
  },
  toggleLiveUpdates: () => {
    const next = !get().liveUpdatesEnabled;
    persistLiveUpdatesPref(next);
    set({
      liveUpdatesEnabled: next,
      sseConnectionState: next ? "connecting" : "disconnected",
    });
  },
}));
