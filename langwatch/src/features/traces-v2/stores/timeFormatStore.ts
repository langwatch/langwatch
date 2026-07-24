import { create } from "zustand";

export type TimeColumnFormat = "relative" | "iso";

const STORAGE_KEY = "langwatch:traces-v2:time-format:v1";
const DEFAULT_FORMAT: TimeColumnFormat = "relative";

interface TimeColumnSizing {
  size: number;
  minSize: number;
  maxSize: number;
}

/**
 * Width the Time column needs for the active value format. Relative labels
 * ("3m", "now") sit comfortably in ~68px, but a full ISO 8601 stamp
 * (`2026-06-02T13:14:15.123Z`, 24 monospace chars) needs ~220px or it
 * clips. Toggling format from the column picker swaps these in so the
 * column tracks its content instead of staying frozen at the relative
 * width — matching the dedicated `timestamp` column's footprint when ISO.
 *
 * Applied as the column def's default/min: a user's manual resize (held in
 * `columnSizingStore`) still wins for the rendered width, but the bumped
 * `minSize` floors a stale narrow override so the stamp never clips in ISO.
 */
export function timeColumnSizing(format: TimeColumnFormat): TimeColumnSizing {
  if (format === "iso") {
    return { size: 220, minSize: 210, maxSize: 260 };
  }
  return { size: 68, minSize: 68, maxSize: 200 };
}

/**
 * How the Time column renders its value — compact relative ("3m") or
 * full ISO 8601 ("2026-06-02T13:14:15.123Z"). A personal display
 * preference (like density), not per-lens or per-URL, so it lives in its
 * own localStorage-backed store and follows the user across lens
 * switches. Switchable from the column picker's Time row.
 */
function load(): TimeColumnFormat {
  if (typeof window === "undefined") return DEFAULT_FORMAT;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "relative" || raw === "iso") return raw;
  } catch {
    // storage may be disabled
  }
  return DEFAULT_FORMAT;
}

function persist(value: TimeColumnFormat): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // storage may be full / disabled
  }
}

interface TimeFormatState {
  format: TimeColumnFormat;
  setFormat: (format: TimeColumnFormat) => void;
}

export const useTimeFormatStore = create<TimeFormatState>((set) => ({
  format: load(),
  setFormat: (format) => {
    persist(format);
    set({ format });
  },
}));
