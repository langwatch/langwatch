import { create } from "zustand";

/**
 * How long a span-row pulse animation lasts. After this the spanId is
 * evicted from the store so subsequent renders don't re-trigger it.
 */
const PULSE_DURATION_MS = 1_200;

/**
 * Minimum gap between two pulses for the same spanId. Bursts of SSE
 * events for the same span within this window coalesce into a single
 * visual pulse — prevents strobe-like animation when the backend
 * batches several span updates close together.
 */
const PULSE_COALESCE_MS = 600;

interface SpanPulseState {
  /** Set of spanIds that are currently pulsing. */
  pulsingIds: Set<string>;
  /**
   * Timestamp of the most recent pulse trigger per spanId.
   * Used to coalesce rapid-fire events for the same span.
   */
  lastPulseAt: Map<string, number>;
  /**
   * Active eviction timers keyed by spanId. Only one timer per id
   * can be active at a time — re-triggering replaces it.
   */
  evictionTimers: Map<string, ReturnType<typeof setTimeout>>;

  /**
   * Trigger a pulse for a spanId. Coalesces events arriving within
   * PULSE_COALESCE_MS. Automatically evicts the id after PULSE_DURATION_MS.
   */
  pulse: (spanId: string) => void;
  /** Remove a spanId from the pulsing set (called by the eviction timer). */
  _evict: (spanId: string) => void;
}

export const useSpanPulseStore = create<SpanPulseState>((set, get) => ({
  pulsingIds: new Set(),
  lastPulseAt: new Map(),
  evictionTimers: new Map(),

  pulse: (spanId) => {
    const state = get();
    const now = Date.now();
    const last = state.lastPulseAt.get(spanId) ?? 0;

    if (now - last < PULSE_COALESCE_MS) return;

    const existingTimer = state.evictionTimers.get(spanId);
    if (existingTimer !== undefined) clearTimeout(existingTimer);

    const timer = setTimeout(() => {
      get()._evict(spanId);
    }, PULSE_DURATION_MS);

    const nextPulsingIds = new Set(state.pulsingIds);
    nextPulsingIds.add(spanId);

    const nextLastPulseAt = new Map(state.lastPulseAt);
    nextLastPulseAt.set(spanId, now);

    const nextEvictionTimers = new Map(state.evictionTimers);
    nextEvictionTimers.set(spanId, timer);

    set({
      pulsingIds: nextPulsingIds,
      lastPulseAt: nextLastPulseAt,
      evictionTimers: nextEvictionTimers,
    });
  },

  _evict: (spanId) => {
    set((s) => {
      const nextPulsingIds = new Set(s.pulsingIds);
      nextPulsingIds.delete(spanId);

      const nextLastPulseAt = new Map(s.lastPulseAt);
      nextLastPulseAt.delete(spanId);

      const nextEvictionTimers = new Map(s.evictionTimers);
      nextEvictionTimers.delete(spanId);

      return {
        pulsingIds: nextPulsingIds,
        lastPulseAt: nextLastPulseAt,
        evictionTimers: nextEvictionTimers,
      };
    });
  },
}));
