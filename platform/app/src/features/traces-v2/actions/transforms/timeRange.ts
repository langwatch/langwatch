import { getPresetById } from "../../utils/timeRangePresets";
import {
  type SetTimeRangePayload,
  setTimeRangePayloadSchema,
} from "../schemas";
import { ExplorerTransformError, type Transform } from "./types";

function epochOf(bound: number | string): number {
  if (typeof bound === "number") return bound;
  const asNumber = Number(bound);
  if (Number.isFinite(asNumber)) return asNumber;
  const parsed = Date.parse(bound);
  if (Number.isNaN(parsed)) {
    throw new ExplorerTransformError({
      code: "time_range_invalid",
      message: `"${bound}" is not a time`,
      meta: { bound },
    });
  }
  return parsed;
}

/**
 * Set the window: a rolling preset resolved now and kept by its id, so the
 * page goes on rolling it, or exact bounds kept as they were given.
 */
export const setTimeRange: Transform<
  SetTimeRangePayload,
  { from: number; to: number; presetId?: string }
> = ({ state, payload }) => {
  const parsed = setTimeRangePayloadSchema.parse(payload);

  if ("preset" in parsed) {
    const preset = getPresetById(parsed.preset);
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
