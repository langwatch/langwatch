import { Temporal, nowInstant } from "@langwatch/time";

const UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000_000],
  ["month", 2_592_000_000],
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
  ["second", 1_000],
];

const zoneOffsetMs = ({ epochMs, timeZone }: { epochMs: number; timeZone: string }) =>
  Temporal.Instant.fromEpochMilliseconds(epochMs).toZonedDateTimeISO(timeZone).offsetNanoseconds /
  1e6;

const offsetLabel = (offsetMs: number) => {
  const sign = offsetMs < 0 ? "-" : "+";
  const minutes = Math.round(Math.abs(offsetMs) / 60_000);
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return `UTC${sign}${hh}:${mm}`;
};

/** An exact wall-clock reading: 24-hour, to the second, so it never needs AM or PM. */
const CLOCK = { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" } as const;

/** One instant through every lens the date hover popover lists. */
export function describeInstant({
  epochMs,
  nowMs = nowInstant().epochMilliseconds,
  locale,
  viewerTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
  sourceTimeZone,
}: {
  epochMs: number;
  nowMs?: number;
  locale?: string;
  viewerTimeZone?: string;
  sourceTimeZone?: string;
}) {
  const inZone = (timeZone: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: "full",
      timeStyle: "long",
      timeZone,
    }).format(epochMs);

  const diff = epochMs - nowMs;
  const [unit, size] = UNITS.find(([, ms]) => Math.abs(diff) >= ms) ?? UNITS[UNITS.length - 1]!;
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(
    Math.trunc(diff / size),
    unit,
  );

  const viewerOffset = zoneOffsetMs({ epochMs, timeZone: viewerTimeZone });
  const sourceOffset = sourceTimeZone ? zoneOffsetMs({ epochMs, timeZone: sourceTimeZone }) : null;
  const shift = (sourceOffset ?? 0) - viewerOffset;
  const hours = Math.abs(shift) / 3_600_000;
  let relativeToViewer = `${viewerTimeZone} is ${offsetLabel(viewerOffset)}`;
  if (sourceOffset !== null) {
    relativeToViewer =
      shift === 0 ? "Same offset as you" : `${hours}h ${shift > 0 ? "ahead of" : "behind"} you`;
  }

  const partsIn = (timeZone: string) => ({
    zone: timeZone,
    text: inZone(timeZone),
    abbreviation:
      new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: "short" })
        .formatToParts(epochMs)
        .find((part) => part.type === "timeZoneName")?.value ?? timeZone,
    date: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone }).format(epochMs),
    time: new Intl.DateTimeFormat(locale, { timeStyle: "medium", timeZone }).format(epochMs),
    clock: new Intl.DateTimeFormat(locale, { ...CLOCK, timeZone }).format(epochMs),
    offset: offsetLabel(zoneOffsetMs({ epochMs, timeZone })),
  });

  return {
    viewer: partsIn(viewerTimeZone),
    utc: inZone("UTC"),
    utcParts: partsIn("UTC"),
    source: sourceTimeZone ? partsIn(sourceTimeZone) : null,
    heading: new Intl.DateTimeFormat(locale, {
      dateStyle: "full",
      timeZone: viewerTimeZone,
    }).format(epochMs),
    relative,
    relativeToViewer,
    iso: Temporal.Instant.fromEpochMilliseconds(epochMs).toString(),
  };
}

/**
 * `datetime`: `Oct 8, 2026, 2:32 PM`; `date` and `time`: one half of it;
 * `relative`: `3 minutes ago`; `auto`, for lists: the time today, the day and
 * time this year, the date before that.
 */
export type InstantDisplay = "datetime" | "date" | "time" | "relative" | "auto";

/** One instant as the label a reader scans, in `timeZone` (the viewer's by default). */
export function formatInstant({
  epochMs,
  display = "datetime",
  nowMs = nowInstant().epochMilliseconds,
  locale,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
  showZone = false,
  seconds = false,
}: {
  epochMs: number;
  display?: InstantDisplay;
  /** Adds seconds to any time the label shows, for a log read to the second. */
  seconds?: boolean;
  nowMs?: number;
  locale?: string;
  timeZone?: string;
  /** Appends the zone's short name, `CEST`, for a time read across zones. */
  showZone?: boolean;
}): string {
  if (display === "relative") return describeInstant({ epochMs, nowMs, locale }).relative;
  const zone = showZone ? ({ timeZoneName: "short" } as const) : {};
  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { timeZone, ...options, ...zone }).format(epochMs);
  const time = {
    hour: "numeric",
    minute: "2-digit",
    ...(seconds ? { second: "2-digit" as const } : {}),
  } as const;
  const date = { year: "numeric", month: "short", day: "numeric" } as const;

  if (display === "date") {
    return new Intl.DateTimeFormat(locale, { timeZone, ...date }).format(epochMs);
  }
  if (display === "time") return format(time);
  if (display === "datetime") return format({ ...date, ...time });

  const at = Temporal.Instant.fromEpochMilliseconds(epochMs).toZonedDateTimeISO(timeZone);
  const now = Temporal.Instant.fromEpochMilliseconds(nowMs).toZonedDateTimeISO(timeZone);
  const today = now.toPlainDate();
  if (at.toPlainDate().equals(today)) return format(time);
  if (at.year === now.year) return format({ month: "short", day: "numeric", ...time });
  return new Intl.DateTimeFormat(locale, { timeZone, ...date }).format(epochMs);
}

/** How long a relative label stays right: a second while fresh, then minutes, then hours. */
export function relativeRefreshMs({ epochMs, nowMs }: { epochMs: number; nowMs: number }): number {
  const age = Math.abs(nowMs - epochMs);
  if (age < 60_000) return 1_000;
  if (age < 3_600_000) return 30_000;
  return 1_800_000;
}
