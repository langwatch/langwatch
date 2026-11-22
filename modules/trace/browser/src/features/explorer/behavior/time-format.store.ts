import { defineSlice } from "@langwatch/browser-host/global-store";

export type TimeColumnFormat = "relative" | "iso";

const DEFAULT_FORMAT: TimeColumnFormat = "relative";

interface TimeColumnSizing {
  size: number;
  minSize: number;
  maxSize: number;
}

/**
 * Width the Time column needs for the active value format. Relative labels ("3m",
 * "now") sit comfortably in ~68px, but a full ISO 8601 stamp
 * (`2026-06-02T13:14:15.123Z`, 24 monospace chars) needs ~220px or it clips.
 */
export function timeColumnSizing(format: TimeColumnFormat): TimeColumnSizing {
  if (format === "iso") {
    return { size: 220, minSize: 210, maxSize: 260 };
  }
  return { size: 68, minSize: 68, maxSize: 200 };
}

interface TimeFormatState {
  format: TimeColumnFormat;
  setFormat: (format: TimeColumnFormat) => void;
}

/**
 * How the Time column renders its value: compact relative ("3m") or full ISO 8601
 * ("2026-06-02T13:14:15.123Z"). The reader's pick, persisted for them (§10.2).
 */
export const useTimeFormatStore = defineSlice<TimeFormatState>({
  name: "trace:time-format",
  create: (set) => ({
    format: DEFAULT_FORMAT,
    setFormat: (format) => set({ format }),
  }),
  persist: { partialize: ({ format }) => ({ format }) },
});
