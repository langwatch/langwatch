export interface TimeRangePreset {
  id: string;
  label: string;
  shortLabel: string;
  compute: () => { from: number; to: number };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function rolling(ms: number): () => { from: number; to: number } {
  return () => {
    const now = Date.now();
    return { from: now - ms, to: now };
  };
}

export const ROLLING_PRESETS: TimeRangePreset[] = [
  { id: "15m", label: "Last 15 minutes", shortLabel: "15m", compute: rolling(15 * MINUTE) },
  { id: "1h", label: "Last 1 hour", shortLabel: "1h", compute: rolling(HOUR) },
  { id: "4h", label: "Last 4 hours", shortLabel: "4h", compute: rolling(4 * HOUR) },
  { id: "24h", label: "Last 24 hours", shortLabel: "24h", compute: rolling(DAY) },
  { id: "7d", label: "Last 7 days", shortLabel: "7d", compute: rolling(7 * DAY) },
  { id: "30d", label: "Last 30 days", shortLabel: "30d", compute: rolling(30 * DAY) },
  { id: "60d", label: "Last 60 days", shortLabel: "60d", compute: rolling(60 * DAY) },
];

export const CALENDAR_PRESETS: TimeRangePreset[] = [
  {
    id: "wtd",
    label: "This week",
    shortLabel: "WTD",
    compute: () => {
      const now = new Date();
      const daysSinceMonday = (now.getDay() + 6) % 7;
      const start = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - daysSinceMonday,
      );
      return { from: start.getTime(), to: now.getTime() };
    },
  },
  {
    id: "mtd",
    label: "This month",
    shortLabel: "MTD",
    compute: () => {
      const now = new Date();
      return {
        from: new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
        to: now.getTime(),
      };
    },
  },
  {
    id: "qtd",
    label: "This quarter",
    shortLabel: "QTD",
    compute: () => {
      const now = new Date();
      const quarterStartMonth = now.getMonth() - (now.getMonth() % 3);
      return {
        from: new Date(now.getFullYear(), quarterStartMonth, 1).getTime(),
        to: now.getTime(),
      };
    },
  },
];

export const ALL_PRESETS: TimeRangePreset[] = [
  ...ROLLING_PRESETS,
  ...CALENDAR_PRESETS,
];

export const PRESET_GROUPS: { label: string; presets: TimeRangePreset[] }[] = [
  { label: "Rolling", presets: ROLLING_PRESETS },
  { label: "Period to date", presets: CALENDAR_PRESETS },
];

export function getPresetById(id: string): TimeRangePreset | undefined {
  return ALL_PRESETS.find((p) => p.id === id);
}

export function matchPreset(range: {
  from: number;
  to: number;
}): TimeRangePreset | null {
  for (const preset of ALL_PRESETS) {
    const computed = preset.compute();
    if (
      Math.abs(range.from - computed.from) < MINUTE &&
      Math.abs(range.to - computed.to) < MINUTE
    ) {
      return preset;
    }
  }
  return null;
}
