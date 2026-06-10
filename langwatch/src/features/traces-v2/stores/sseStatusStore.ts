import { create } from "zustand";
import type { ConnectionState } from "~/hooks/useSSESubscription";

const LIVE_UPDATES_STORAGE_KEY =
  "langwatch:traces-v2:live-updates-mode:v1";
/** Legacy boolean preference from before "ask" mode existed. */
const LEGACY_LIVE_UPDATES_BOOL_KEY =
  "langwatch:traces-v2:live-updates-enabled:v1";

/**
 * Three-state live update preference.
 *
 * - `live`: SSE on, table auto-refreshes as updates arrive (the historic
 *   "enabled" behaviour).
 * - `ask`: SSE on so the `(N new)` pill knows when new rows exist, but
 *   the table does NOT auto-refresh. The user opts in by clicking the
 *   pill — avoids the list jumping under the cursor mid-read. Reuses
 *   the same floating pill the scrolled-list overlay shows in live
 *   mode, so there is one and only one "new rows available" affordance.
 * - `paused`: SSE off entirely — no updates, no pill, no polling.
 */
export type LiveUpdatesMode = "live" | "ask" | "paused";

function readLiveUpdatesMode(): LiveUpdatesMode {
  if (typeof window === "undefined") return "live";
  try {
    const raw = window.localStorage.getItem(LIVE_UPDATES_STORAGE_KEY);
    if (raw === "live" || raw === "ask" || raw === "paused") return raw;
    // Migrate from the boolean key: true → live, false → paused. No
    // "ask" inference — there's nothing in the old shape to point at it
    // and starting an existing user in a new mode would be surprising.
    const legacy = window.localStorage.getItem(LEGACY_LIVE_UPDATES_BOOL_KEY);
    if (legacy === "false") return "paused";
    return "live";
  } catch {
    return "live";
  }
}

function persistLiveUpdatesMode(value: LiveUpdatesMode) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LIVE_UPDATES_STORAGE_KEY, value);
    // Keep the legacy boolean key roughly in sync so any consumer still
    // reading it doesn't get stuck on the old default.
    window.localStorage.setItem(
      LEGACY_LIVE_UPDATES_BOOL_KEY,
      String(value !== "paused"),
    );
  } catch {
    // Best-effort persistence.
  }
}

/** Mode cycle: live → ask → paused → live. */
function nextMode(mode: LiveUpdatesMode): LiveUpdatesMode {
  if (mode === "live") return "ask";
  if (mode === "ask") return "paused";
  return "live";
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
   * Three-state live update preference. Persisted to localStorage so the
   * choice survives reloads. See {@link LiveUpdatesMode} for semantics.
   */
  liveUpdatesMode: LiveUpdatesMode;
  /**
   * Convenience derivation: true when SSE should be subscribed at all
   * (live OR ask). Paused short-circuits the subscription.
   */
  liveUpdatesEnabled: boolean;
  setLiveUpdatesMode: (mode: LiveUpdatesMode) => void;
  /** Cycle live → ask → paused → live. */
  toggleLiveUpdates: () => void;
}

const initialMode = readLiveUpdatesMode();

export const useSseStatusStore = create<SseStatusState>((set) => ({
  sseConnectionState: initialMode === "paused" ? "disconnected" : "connecting",
  setSseConnectionState: (state) => set({ sseConnectionState: state }),
  lastEventAt: 0,
  setLastEventAt: (ts) => set({ lastEventAt: ts }),
  fastPollRequestedAt: 0,
  requestFastPoll: () => set({ fastPollRequestedAt: Date.now() }),
  liveUpdatesMode: initialMode,
  liveUpdatesEnabled: initialMode !== "paused",
  setLiveUpdatesMode: (mode) => {
    persistLiveUpdatesMode(mode);
    set({
      liveUpdatesMode: mode,
      liveUpdatesEnabled: mode !== "paused",
      sseConnectionState: mode === "paused" ? "disconnected" : "connecting",
    });
  },
  toggleLiveUpdates: () => {
    set((state) => {
      const next = nextMode(state.liveUpdatesMode);
      persistLiveUpdatesMode(next);
      return {
        liveUpdatesMode: next,
        liveUpdatesEnabled: next !== "paused",
        sseConnectionState: next === "paused" ? "disconnected" : "connecting",
      };
    });
  },
}));
