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
 * - `ask`: SSE on so we know when new rows exist, but the table does NOT
 *   auto-refresh. Instead a "(N new)" badge surfaces in the toolbar and
 *   the user opts in by clicking it. Avoids the list jumping under the
 *   cursor while the operator is reading a row.
 * - `paused`: SSE off entirely — no updates, no badge, no polling.
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

  /**
   * Trace IDs seen by SSE while in `ask` mode that the user hasn't
   * acknowledged yet. The toolbar badge shows the size; flushing
   * invalidates the list and clears the buffer.
   */
  pendingTraceIds: Set<string>;
  recordPendingTraceIds: (ids: string[]) => void;
  clearPendingTraceIds: () => void;
}

const initialMode = readLiveUpdatesMode();

export const useSseStatusStore = create<SseStatusState>((set, get) => ({
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
      // Switching out of `ask` mode drops the buffered acks — they're
      // about to be flushed by the live refetch, or they're irrelevant
      // because the user is now ignoring updates entirely.
      ...(mode !== "ask" ? { pendingTraceIds: new Set<string>() } : {}),
    });
  },
  toggleLiveUpdates: () => {
    const next = nextMode(get().liveUpdatesMode);
    persistLiveUpdatesMode(next);
    set({
      liveUpdatesMode: next,
      liveUpdatesEnabled: next !== "paused",
      sseConnectionState: next === "paused" ? "disconnected" : "connecting",
      ...(next !== "ask" ? { pendingTraceIds: new Set<string>() } : {}),
    });
  },

  pendingTraceIds: new Set<string>(),
  recordPendingTraceIds: (ids) => {
    if (ids.length === 0) return;
    set((state) => {
      // Cap the buffer so a runaway producer can't grow it unboundedly.
      // The UI only renders `size` as a count anyway, so dropping the
      // tail past 9999 has no visible effect besides bounded memory.
      const merged = new Set(state.pendingTraceIds);
      for (const id of ids) {
        if (merged.size >= 9999) break;
        merged.add(id);
      }
      return { pendingTraceIds: merged };
    });
  },
  clearPendingTraceIds: () =>
    set({ pendingTraceIds: new Set<string>() }),
}));
