import {
  ALL_PRESETS,
  PRESET_MATCH_TOLERANCE_MS,
  PRESETS_BY_ID,
  type TimeRangePreset,
} from "@langwatch/trace-contract";

// The preset table is contract data (the away executor resolves the same ids
// server-side); the two nullable lookups over it stay on the browser side.
export {
  ALL_PRESETS,
  CALENDAR_PRESETS,
  PRESET_GROUPS,
  ROLLING_PRESETS,
  type TimeRangePreset,
} from "@langwatch/trace-contract";

/** The preset the picker offers under this id, or nothing if it offers none. */
export function getPresetById(id: string): TimeRangePreset | undefined {
  return PRESETS_BY_ID[id];
}

/** The preset a window came from, when a preset computes the same window now. */
export function matchPreset(range: { from: number; to: number }): TimeRangePreset | null {
  for (const preset of ALL_PRESETS) {
    const computed = preset.compute();
    const fromMatches = Math.abs(range.from - computed.from) < PRESET_MATCH_TOLERANCE_MS;
    const toMatches = Math.abs(range.to - computed.to) < PRESET_MATCH_TOLERANCE_MS;
    if (fromMatches && toMatches) {
      return preset;
    }
  }
  return null;
}
