import { useEffect } from "react";
import { useFilterStore } from "../stores/filterStore";
import { getPresetById } from "../utils/timeRangePresets";

const TICK_MS = 30_000;
const MIN_DRIFT_MS = 15_000;

export function useRollingTimeRange(): void {
  useEffect(() => {
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
    const interval = setInterval(tick, TICK_MS);
    return () => clearInterval(interval);
  }, []);
}
