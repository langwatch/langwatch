/**
 * The window the audit trail is read over, as a value rather than as a hook.
 *
 * A NARROWED FAMILY-LOCAL COPY of `platform/app/src/components/PeriodSelector.tsx`.
 * That module has twenty-odd callers across analytics, agent testing and the
 * home page, so it stays where it is and this family takes what it uses. Two
 * things changed on the way, and both are why it is a copy rather than a move:
 *
 * - THE ROUTER IS GONE. The platform hook read `router.query` and called
 *   `router.push` itself, which is exactly the import ADR-004 seals off from a
 *   screen. Here the reading is a pure function of the query the host hands
 *   over, and the writes answer with the NEXT WHOLE QUERY for the host to
 *   apply. That is what makes the two of them assertable without a router.
 * - THE ABSOLUTE-RANGE INPUTS AND THE "All time" ENTRY did not travel: the
 *   audit trail always has a window, and its picker only ever offered presets.
 *
 * `now` is a parameter everywhere. A relative window anchored to a hidden clock
 * is a function whose answer nobody can state, and the audit trail's default is
 * relative.
 */

import { differenceInCalendarDays, startOfDay, subDays } from "date-fns";

/** The window a read is taken over. */
export type AuditPeriod = { startDate: Date; endDate: Date };

/**
 * Relative range presets. The key is what is serialised into the URL as
 * `?period=<key>`; `minutes` is the lookback from "now" for the sub-day
 * windows, and `days` the inclusive day count for the rest.
 */
export const AUDIT_PERIOD_PRESETS = [
  { key: "15m", label: "Last 15 minutes", minutes: 15, days: 1 },
  { key: "1h", label: "Last 1 hour", minutes: 60, days: 1 },
  { key: "6h", label: "Last 6 hours", minutes: 60 * 6, days: 1 },
  { key: "24h", label: "Last 24 hours", minutes: 60 * 24, days: 1 },
  { key: "today", label: "Today", minutes: null, days: 1 },
  { key: "7d", label: "Last 7 days", minutes: null, days: 7 },
  { key: "15d", label: "Last 15 days", minutes: null, days: 15 },
  { key: "30d", label: "Last 30 days", minutes: null, days: 30 },
  { key: "90d", label: "Last 90 days", minutes: null, days: 90 },
  { key: "6mo", label: "Last 6 months", minutes: null, days: 180 },
  { key: "1y", label: "Last 1 year", minutes: null, days: 365 },
] as const;

export type AuditPeriodPresetKey = (typeof AUDIT_PERIOD_PRESETS)[number]["key"];

const PRESETS_BY_KEY = new Map(AUDIT_PERIOD_PRESETS.map((preset) => [preset.key, preset]));

/** Whether the URL's `?period=` names a window this picker offers. */
export function isAuditPeriodPresetKey(value: unknown): value is AuditPeriodPresetKey {
  return typeof value === "string" && PRESETS_BY_KEY.has(value as AuditPeriodPresetKey);
}

const isReadableDate = (value: string): boolean => !isNaN(new Date(value).getTime());

/**
 * The [start, end] window for a preset, anchored to `now`.
 *
 * Day-based presets snap the start to start-of-day, which is what makes
 * "Last 7 days" mean seven whole days rather than a hundred and sixty-eight
 * hours ending at an arbitrary minute.
 */
export function computeAuditWindow(presetKey: AuditPeriodPresetKey, now: Date): AuditPeriod {
  const preset = PRESETS_BY_KEY.get(presetKey);
  if (!preset) return { startDate: startOfDay(subDays(now, 29)), endDate: now };
  if (preset.minutes !== null) {
    return { startDate: new Date(now.getTime() - preset.minutes * 60 * 1000), endDate: now };
  }
  return { startDate: startOfDay(subDays(now, preset.days - 1)), endDate: now };
}

/** How the window on screen was arrived at. */
export type AuditPeriodMode = "relative" | "absolute";

export type AuditPeriodReading = {
  period: AuditPeriod;
  mode: AuditPeriodMode;
};

const DEFAULT_PRESET: AuditPeriodPresetKey = "30d";

/**
 * The window the address describes.
 *
 * An explicit `startDate`/`endDate` pair wins, and a reversed pair is clamped
 * rather than refused — a hand-edited URL should narrow to nothing visible, not
 * ask the server for a range that runs backwards. Anything else falls back to
 * the named preset, and then to thirty days.
 */
export function readAuditPeriod(
  query: Readonly<Record<string, string | undefined>>,
  now: Date,
): AuditPeriodReading {
  const start = query.startDate;
  const end = query.endDate;
  if (start && end && isReadableDate(start) && isReadableDate(end)) {
    const startDate = new Date(start);
    const endDate = new Date(end);
    return {
      period: { startDate: startDate > endDate ? endDate : startDate, endDate },
      mode: "absolute",
    };
  }

  const presetKey = isAuditPeriodPresetKey(query.period) ? query.period : DEFAULT_PRESET;
  return { period: computeAuditWindow(presetKey, now), mode: "relative" };
}

/**
 * The next whole query for a picked preset.
 *
 * An absolute pair already in the URL is DROPPED rather than left beside the
 * preset: the reading above prefers the pair, so leaving it would make the
 * picker look like it did nothing. Paging is reset for the same reason every
 * filter change resets it — page four of the old window is not page four of the
 * new one.
 */
export function auditPeriodQuery(
  query: Readonly<Record<string, string | undefined>>,
  presetKey: AuditPeriodPresetKey,
): Record<string, string | undefined> {
  const { startDate: _start, endDate: _end, ...rest } = query;
  return { ...rest, period: presetKey, pageOffset: "0" };
}

/**
 * The label the trigger reads, for a window that matches a preset or not.
 *
 * THE SUB-DAY PRESETS ARE CHECKED FIRST, which is a deliberate correction of
 * the platform control rather than a copy of it. There, the calendar-day match
 * ran first, and every window shorter than a day spans one calendar day — so
 * picking "Last 1 hour" relabelled the trigger "Today", and four of the eleven
 * presets could not be read back off the control that set them.
 */
export function auditPeriodLabel(
  { startDate, endDate }: AuditPeriod,
  mode: AuditPeriodMode,
  now: Date,
): string {
  if (mode === "relative") {
    const minutes = Math.round((endDate.getTime() - startDate.getTime()) / 60000);
    const subDay = AUDIT_PERIOD_PRESETS.find((preset) => preset.minutes === minutes);
    if (subDay) return subDay.label;

    const days = differenceInCalendarDays(endDate, startDate) + 1;
    const fromToday = differenceInCalendarDays(now, endDate) + 1;
    if (fromToday <= 1) {
      const byDays = AUDIT_PERIOD_PRESETS.find(
        (preset) => preset.minutes === null && preset.days === days,
      );
      if (byDays) return byDays.label;
    }
  }
  return `${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`;
}
