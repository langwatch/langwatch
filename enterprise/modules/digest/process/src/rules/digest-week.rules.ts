// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** ISO weeks, and the two weekly folds: pure state and the functions that grow it. */
import { Temporal } from "@langwatch/time";
import { z } from "zod";

const MONTH_LABELS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
/** The send goes out after Monday 08:00 UTC, for the week that just ended. */
export const SEND_HOUR_UTC = 8;
/** The weeks before the sent one that the scenario baseline averages over. */
export const BASELINE_WEEKS = 4;

export const MAX_MODELS = 20;
export const MAX_EVALUATORS = 20;
export const MAX_SESSIONS = 200;
export const MAX_SERIES = 500;
export const MAX_REPOSITORIES = 20;

/** Whether a plan at a moment may send, and the week it sends when it may. */
export type PlannableWeek = { kind: "open"; isoWeek: string } | { kind: "closed" };

const utcDayOf = (epochMs: number) =>
  Temporal.Instant.fromEpochMilliseconds(epochMs).toZonedDateTimeISO("UTC").toPlainDate();

/** `2026-W39`: ISO week-numbering year and week, so 2027-01-01 is 2026-W53. */
const isoWeekOfDay = (day: ReturnType<typeof utcDayOf>) =>
  `${day.yearOfWeek}-W${String(day.weekOfYear).padStart(2, "0")}`;

/** `Dec 1`, the way a template names a day. */
const dayLabel = ({ month, day }: { month: number; day: number }) =>
  `${MONTH_LABELS[month - 1]} ${day}`;

const mondayOf = (isoWeek: string) => {
  const [yearPart, weekPart] = isoWeek.split("-W");
  // Week 1 is the week that holds January 4th.
  const jan4 = Temporal.PlainDate.from({ year: Number(yearPart), month: 1, day: 4 });
  return jan4.subtract({ days: jan4.dayOfWeek - 1 }).add({ weeks: Number(weekPart) - 1 });
};

/** The ISO 8601 week an instant falls in, `2026-W39`. */
export function isoWeekOf(epochMs: number): string {
  return isoWeekOfDay(utcDayOf(epochMs));
}

/** Monday 00:00 UTC of an ISO week. */
export function weekStartOf(isoWeek: string): number {
  return mondayOf(isoWeek).toZonedDateTime("UTC").epochMilliseconds;
}

/** The `count` weeks before `isoWeek`, newest first. */
export function weeksBefore({ isoWeek, count }: { isoWeek: string; count: number }): string[] {
  const monday = mondayOf(isoWeek);
  return Array.from({ length: count }, (_, index) =>
    isoWeekOfDay(monday.subtract({ weeks: index + 1 })),
  );
}

/** Monday 08:00 UTC of an ISO week, when its send opens. */
function sendOpensAt(isoWeek: string): number {
  const weekStart = Temporal.Instant.fromEpochMilliseconds(weekStartOf(isoWeek));
  return weekStart.add({ hours: SEND_HOUR_UTC }).epochMilliseconds;
}

/** The finished week a send at `now` covers: last week once Monday 08:00 UTC has passed. */
export function sendableWeek(now: number): string {
  const current = isoWeekOf(now);
  const [lastWeek, weekBefore] = weeksBefore({ isoWeek: current, count: 2 });
  return (now >= sendOpensAt(current) ? lastWeek : weekBefore) ?? current;
}

/**
 * The week a plan at `now` may send: last week once this week's send opened at Monday 08:00
 * UTC, and closed before then. The sendable week before 08:00 is the week before last, so planning
 * it would mail a second, older week to anyone armed in those hours.
 */
export function plannableWeek(now: number): PlannableWeek {
  return now >= sendOpensAt(isoWeekOf(now))
    ? { kind: "open", isoWeek: sendableWeek(now) }
    : { kind: "closed" };
}

/** The oldest week kept at `now`: the sendable week's baseline still needs its four. */
export function oldestKeptWeek(now: number): string {
  const sendable = sendableWeek(now);
  return weeksBefore({ isoWeek: sendable, count: BASELINE_WEEKS }).at(-1) ?? sendable;
}

/** `Sep 22 to 28`, the way a template names the week it covers. */
export function weekLabel(isoWeek: string): string {
  const start = mondayOf(isoWeek);
  const end = start.add({ days: 6 });
  const endText = start.month === end.month ? String(end.day) : dayLabel(end);
  return `${dayLabel(start)} to ${endText}`;
}

/** `Dec 1`: the first of the month after the one `now` falls in, when a monthly count resets. */
export function nextMonthLabel(now: number): string {
  return dayLabel(utcDayOf(now).with({ day: 1 }).add({ months: 1 }));
}

/** Whole UTC days from `now`'s day to the first of next month: 8 on Nov 23. */
export function daysUntilNextMonth(now: number): number {
  const today = utcDayOf(now);
  return today.until(today.with({ day: 1 }).add({ months: 1 }), { largestUnit: "days" }).days;
}

const outcomeCountsSchema = z.object({
  runs: z.number(),
  passed: z.number(),
  failed: z.number(),
});
export type OutcomeCounts = z.infer<typeof outcomeCountsSchema>;

export const projectWeekStateSchema = z.object({
  projectId: z.string(),
  organizationId: z.string(),
  isoWeek: z.string(),
  evaluators: z.record(z.string(), outcomeCountsSchema),
  scenarios: outcomeCountsSchema,
});
/** What the project's folds hold: outcomes only, since trace numbers are read from analytics. */
export type ProjectWeekState = z.infer<typeof projectWeekStateSchema>;

/** What analytics says a project's traces did in one week; never stored. */
export type TraceWeek = Readonly<{
  traces: number;
  errors: number;
  tokens: number;
  costUsd: number;
  /** Median and 95th-percentile trace duration. */
  p50Ms: number;
  p95Ms: number;
  /** Traces per model, the most used first. */
  models: Readonly<Record<string, number>>;
}>;

/** A project's week as an email reads it: its outcome folds and its trace numbers. */
export type ProjectWeek = ProjectWeekState & TraceWeek;

export const userWeekStateSchema = z.object({
  userId: z.string(),
  organizationId: z.string(),
  isoWeek: z.string(),
  sessions: z.array(z.string()),
  /** Sessions seen after the capped set filled; counted, not kept. */
  sessionOverflow: z.number(),
  series: z.record(
    z.string(),
    z.object({ metric: z.string(), type: z.string().nullable(), value: z.number() }),
  ),
  /** Series readings seen after the capped set filled; counted, not kept or summed. */
  seriesOverflow: z.number(),
  repositories: z.record(z.string(), z.number()),
  /**
   * The repository each session was counted for, so a session counts once however its facts
   * arrive; capped at MAX_SESSIONS.
   */
  sessionRepositories: z.record(z.string(), z.string()),
});
export type UserWeekState = z.infer<typeof userWeekStateSchema>;

const noOutcomes = (): OutcomeCounts => ({ runs: 0, passed: 0, failed: 0 });

export function emptyProjectWeek(): ProjectWeekState {
  return {
    projectId: "",
    organizationId: "",
    isoWeek: "",
    evaluators: {},
    scenarios: noOutcomes(),
  };
}

export function emptyUserWeek(): UserWeekState {
  return {
    userId: "",
    organizationId: "",
    isoWeek: "",
    sessions: [],
    sessionOverflow: 0,
    series: {},
    seriesOverflow: 0,
    repositories: {},
    sessionRepositories: {},
  };
}

/** Adds one to a capped counter map; a key that would pass the cap is dropped. */
export function countCapped({
  counts,
  key,
  by = 1,
  cap,
}: {
  counts: Record<string, number>;
  key: string;
  by?: number;
  cap: number;
}): Record<string, number> {
  // Own keys only: a key named `constructor` must not read the prototype's.
  const current = Object.hasOwn(counts, key) ? counts[key] : undefined;
  if (current === undefined && Object.keys(counts).length >= cap) return counts;
  return { ...counts, [key]: (current ?? 0) + by };
}

export function addOutcome({
  counts,
  outcome,
}: {
  counts: OutcomeCounts;
  outcome: "passed" | "failed" | "other";
}): OutcomeCounts {
  return {
    runs: counts.runs + 1,
    passed: counts.passed + (outcome === "passed" ? 1 : 0),
    failed: counts.failed + (outcome === "failed" ? 1 : 0),
  };
}

/** A person's week, summed from the agents' converged metric series. */
export function userWeekTotals(state: UserWeekState): {
  sessions: number;
  tokens: number;
  costUsd: number;
  activeSeconds: number;
  linesChanged: number;
  commits: number;
  pullRequests: number;
  /** Series were dropped past the cap, so each metric total is a floor. */
  atLeast: boolean;
} {
  const sum = (metric: string) =>
    Object.values(state.series)
      .filter((series) => series.metric === metric)
      .reduce((total, series) => total + series.value, 0);
  return {
    sessions: state.sessions.length + state.sessionOverflow,
    tokens: Math.round(sum("token_usage")),
    costUsd: sum("cost_usage"),
    activeSeconds: sum("active_time"),
    linesChanged: Math.round(sum("lines_of_code")),
    commits: Math.round(sum("commit")),
    pullRequests: Math.round(sum("pull_request")),
    atLeast: state.seriesOverflow > 0,
  };
}
