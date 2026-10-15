/** The days a dashboards demo run covers, each placed on the prototype's calendar. */
import { type Instant, Temporal } from "@langwatch/time";

/** The prototype's last day; the seed maps it onto today. */
export const PROTOTYPE_LAST_DAY = 89;

const DAY_MS = 86_400_000;

export interface DemoDay {
  /** The UTC date, YYYY-MM-DD; it names every id made that day. */
  key: string;
  /** 0 is Sunday, 6 is Saturday. */
  weekday: number;
  /** Midnight UTC, epoch milliseconds. */
  dayStart: number;
  daysAgo: number;
  /** The same day on the prototype's calendar, where story changes are dated. */
  prototypeDay: number;
}

/** The run's days, oldest first, ending today. */
export function demoDays({ days, todayStart }: { days: number; todayStart: number }): DemoDay[] {
  return Array.from({ length: days }, (_, offset) => {
    const daysAgo = days - 1 - offset;
    const dayStart = todayStart - daysAgo * DAY_MS;
    const date = Temporal.Instant.fromEpochMilliseconds(dayStart).toZonedDateTimeISO("UTC");
    return {
      key: date.toPlainDate().toString(),
      weekday: date.dayOfWeek % 7,
      dayStart,
      daysAgo,
      prototypeDay: PROTOTYPE_LAST_DAY - daysAgo,
    };
  });
}

export const isWeekend = (day: DemoDay): boolean => day.weekday === 0 || day.weekday === 6;

export const instantAt = (ms: number): Instant => Temporal.Instant.fromEpochMilliseconds(ms);
