import { Temporal } from "@langwatch/time";

import { PRESETS_BY_ID } from "../../../trace-time-range-presets.ts";
import { type SetTimeRangePayload, setTimeRangePayloadSchema } from "../schemas.ts";
import { ExplorerTransformError, type ExplorerTransform } from "./types.ts";

function epochOf(bound: number | string): number {
  if (typeof bound === "number") return bound;
  const asNumber = Number(bound);
  if (Number.isFinite(asNumber)) return asNumber;
  try {
    return Temporal.Instant.from(bound).epochMilliseconds;
  } catch {
    throw new ExplorerTransformError({
      code: "time_range_invalid",
      message: `"${bound}" is not a time`,
      meta: { bound },
    });
  }
}

/**
 * Set the window: a rolling preset resolved now and kept by its id, so the
 * page goes on rolling it, or exact bounds kept as they were given.
 */
export const setTimeRange: ExplorerTransform<
  SetTimeRangePayload,
  { from: number; to: number; presetId?: string }
> = ({ state, payload }) => {
  const parsed = setTimeRangePayloadSchema.parse(payload);

  if ("preset" in parsed) {
    const preset = PRESETS_BY_ID[parsed.preset];
    if (!preset) {
      throw new ExplorerTransformError({
        code: "preset_unknown",
        message: `No time range preset "${parsed.preset}"`,
        meta: { preset: parsed.preset },
      });
    }
    const { from, to } = preset.compute();
    return {
      state: {
        ...state,
        timeRange: { from, to, label: preset.label, presetId: preset.id },
        page: 1,
      },
      result: { from, to, presetId: preset.id },
    };
  }

  const from = epochOf(parsed.from);
  const to = epochOf(parsed.to);
  if (to <= from) {
    throw new ExplorerTransformError({
      code: "time_range_invalid",
      message: "The window must end after it starts",
      meta: { from, to },
    });
  }
  return {
    state: { ...state, timeRange: { from, to }, page: 1 },
    result: { from, to },
  };
};
