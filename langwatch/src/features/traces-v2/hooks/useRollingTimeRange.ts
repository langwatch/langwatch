import { useEffect } from "react";
import { usePageVisibility } from "~/hooks/usePageVisibility";
import { useDrawerStore } from "../stores/drawerStore";
import { useFilterStore } from "../stores/filterStore";
import { getPresetById } from "../utils/timeRangePresets";

// Each tick rolls the live time range forward, which invalidates every
// query that includes timeRange in its input (discover, list, newCount,
// facetValues × N). 30s was visibly thrashy in profiling; 60s reads as
// "live" for trace monitoring without the per-half-minute refetch storm.
const TICK_MS = 60_000;
const MIN_DRIFT_MS = 15_000;

export function useRollingTimeRange(): void {
  const isVisible = usePageVisibility();
  // While the drawer is open the user is reading a single trace — rolling
  // the table's window underneath them just costs network and re-renders
  // they can't see.
  const drawerOpen = useDrawerStore((s) => s.isOpen);

  useEffect(() => {
    if (!isVisible || drawerOpen) return;

    const tick = () => {
      const state = useFilterStore.getState();
      const range = state.timeRange;
      if (!range.presetId) return;
      const preset = getPresetById(range.presetId);
      if (!preset) return;
      const fresh = preset.compute();
      if (Math.abs(fresh.to - range.to) < MIN_DRIFT_MS) return;
      state.rollTimeRange({
        from: fresh.from,
        to: fresh.to,
        label: range.label,
        presetId: range.presetId,
      });
    };
    // Catch up immediately on focus — the time range may have drifted
    // far past MIN_DRIFT_MS while we were hidden.
    tick();
    const interval = setInterval(tick, TICK_MS);
    return () => clearInterval(interval);
  }, [isVisible, drawerOpen]);
}
