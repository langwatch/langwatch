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

  return {
    viewer: { zone: viewerTimeZone, text: inZone(viewerTimeZone) },
    utc: inZone("UTC"),
    source: sourceTimeZone ? { zone: sourceTimeZone, text: inZone(sourceTimeZone) } : null,
    relative,
    relativeToViewer,
    iso: Temporal.Instant.fromEpochMilliseconds(epochMs).toString(),
  };
}
