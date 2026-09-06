import { create } from "zustand";

/**
 * How long a pulse animation lasts. After this the traceId is evicted
 * from the store so subsequent renders don't re-trigger the animation.
 */
const PULSE_DURATION_MS = 1_200;

/**
 * Minimum gap between two pulses for the same traceId. Bursts of SSE
 * events for the same trace within this window coalesce into a single
 * visual pulse — prevents strobe-like animation on high-throughput
 * projects.
 */
const PULSE_COALESCE_MS = 600;

interface RowPulseState {
  /** Set of traceIds that are currently pulsing. */
  pulsingIds: Set<string>;
  /**
   * Timestamp of the most recent pulse trigger per traceId.
   * Used to coalesce rapid-fire events for the same trace.
   */
  lastPulseAt: Map<string, number>;
  /**
   * Active eviction timers keyed by traceId. Only one timer per id
   * can be active at a time — re-triggering replaces it.
   */
  evictionTimers: Map<string, ReturnType<typeof setTimeout>>;

  /**
   * Trigger a pulse for a traceId. Coalesces events arriving within
   * PULSE_COALESCE_MS. Automatically evicts the id after PULSE_DURATION_MS.
   */
  pulse: (traceId: string) => void;
  /** Remove a traceId from the pulsing set (called by the eviction timer). */
  _evict: (traceId: string) => void;
}

export const useRowPulseStore = create<RowPulseState>((set, get) => ({
  pulsingIds: new Set(),
  lastPulseAt: new Map(),
  evictionTimers: new Map(),

  pulse: (traceId) => {
    const state = get();
    const now = Date.now();
    const last = state.lastPulseAt.get(traceId) ?? 0;

    if (now - last < PULSE_COALESCE_MS) {
      // Within the coalesce window — skip this burst event.
      return;
    }

    // Cancel any existing eviction timer for this trace so we don't
    // evict mid-animation when it gets re-triggered.
    const existingTimer = state.evictionTimers.get(traceId);
    if (existingTimer !== undefined) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      get()._evict(traceId);
    }, PULSE_DURATION_MS);

    const nextPulsingIds = new Set(state.pulsingIds);
    nextPulsingIds.add(traceId);

    const nextLastPulseAt = new Map(state.lastPulseAt);
    nextLastPulseAt.set(traceId, now);

    const nextEvictionTimers = new Map(state.evictionTimers);
    nextEvictionTimers.set(traceId, timer);

    set({
      pulsingIds: nextPulsingIds,
      lastPulseAt: nextLastPulseAt,
      evictionTimers: nextEvictionTimers,
    });
  },

  _evict: (traceId) => {
    set((s) => {
      const nextPulsingIds = new Set(s.pulsingIds);
      nextPulsingIds.delete(traceId);

      const nextLastPulseAt = new Map(s.lastPulseAt);
      nextLastPulseAt.delete(traceId);

      const nextEvictionTimers = new Map(s.evictionTimers);
      nextEvictionTimers.delete(traceId);

      return {
        pulsingIds: nextPulsingIds,
        lastPulseAt: nextLastPulseAt,
        evictionTimers: nextEvictionTimers,
      };
    });
  },
}));
