// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** ISO weeks, and the two weekly folds: pure state and the functions that grow it. */
import { z } from "zod";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
/** The send goes out after Monday 08:00 UTC, for the week that just ended. */
export const SEND_HOUR_UTC = 8;
/** The weeks before the sent one that the scenario baseline averages over. */
export const BASELINE_WEEKS = 4;

/** Upper bounds of the latency histogram's buckets; one overflow bucket follows. */
export const LATENCY_BUCKETS_MS = [100, 250, 500, 1_000, 2_000, 5_000, 10_000, 30_000, 60_000];
export const MAX_MODELS = 20;
export const MAX_EVALUATORS = 20;
export const MAX_SCENARIOS = 50;
export const MAX_SESSIONS = 200;
export const MAX_SERIES = 500;
export const MAX_REPOSITORIES = 20;

/** The ISO 8601 week an instant falls in, `2026-W39`. */
export function isoWeekOf(epochMs: number): string {
  const date = new Date(epochMs);
  const day = (date.getUTCDay() + 6) % 7;
  const thursday = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - day + 3);
  const year = new Date(thursday).getUTCFullYear();
  const week = Math.floor((thursday - Date.UTC(year, 0, 1)) / WEEK_MS) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** Monday 00:00 UTC of an ISO week. */
export function weekStartOf(isoWeek: string): number {
  const [yearPart, weekPart] = isoWeek.split("-W");
  const year = Number(yearPart);
  const jan4 = Date.UTC(year, 0, 4);
  const jan4Day = (new Date(jan4).getUTCDay() + 6) % 7;
  return jan4 - jan4Day * DAY_MS + (Number(weekPart) - 1) * WEEK_MS;
}

/** The `count` weeks before `isoWeek`, newest first. */
export function weeksBefore({ isoWeek, count }: { isoWeek: string; count: number }): string[] {
  const start = weekStartOf(isoWeek);
  return Array.from({ length: count }, (_, index) => isoWeekOf(start - (index + 1) * WEEK_MS));
}

/** The finished week a send at `now` covers: last week once Monday 08:00 UTC has passed. */
export function sendableWeek(now: number): string {
  const current = isoWeekOf(now);
  const opensAt = weekStartOf(current) + SEND_HOUR_UTC * HOUR_MS;
  const [lastWeek, weekBefore] = weeksBefore({ isoWeek: current, count: 2 });
  return (now >= opensAt ? lastWeek : weekBefore) ?? current;
}

/**
 * The week a plan at `now` may send: last week once this week's send opened at Monday 08:00
 * UTC, and none before then. The sendable week before 08:00 is the week before last, so planning
 * it would mail a second, older week to anyone armed in those hours.
 */
export function plannableWeek(now: number): string | null {
  const opensAt = weekStartOf(isoWeekOf(now)) + SEND_HOUR_UTC * HOUR_MS;
  return now >= opensAt ? sendableWeek(now) : null;
}

/** The oldest week kept at `now`: the sendable week's baseline still needs its four. */
export function oldestKeptWeek(now: number): string {
  const sendable = sendableWeek(now);
  return weeksBefore({ isoWeek: sendable, count: BASELINE_WEEKS }).at(-1) ?? sendable;
}

/** `Sep 22 to 28`, the way a template names the week it covers. */
export function weekLabel(isoWeek: string): string {
  const start = new Date(weekStartOf(isoWeek));
  const end = new Date(weekStartOf(isoWeek) + 6 * DAY_MS);
  const month = (date: Date) => date.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const endText =
    start.getUTCMonth() === end.getUTCMonth()
      ? String(end.getUTCDate())
      : `${month(end)} ${end.getUTCDate()}`;
  return `${month(start)} ${start.getUTCDate()} to ${endText}`;
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
  traces: z.number(),
  spans: z.number(),
  errors: z.number(),
  tokens: z.number(),
  costUsd: z.number(),
  latency: z.array(z.number()),
  models: z.record(z.string(), z.number()),
  evaluations: outcomeCountsSchema,
  evaluators: z.record(z.string(), outcomeCountsSchema),
  scenarios: outcomeCountsSchema,
  scenarioFailures: z.record(z.string(), z.number()),
});
export type ProjectWeekState = z.infer<typeof projectWeekStateSchema>;

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
  repositories: z.record(z.string(), z.number()),
});
export type UserWeekState = z.infer<typeof userWeekStateSchema>;

const noOutcomes = (): OutcomeCounts => ({ runs: 0, passed: 0, failed: 0 });

export function emptyProjectWeek(): ProjectWeekState {
  return {
    projectId: "",
    organizationId: "",
    isoWeek: "",
    traces: 0,
    spans: 0,
    errors: 0,
    tokens: 0,
    costUsd: 0,
    latency: LATENCY_BUCKETS_MS.map(() => 0).concat(0),
    models: {},
    evaluations: noOutcomes(),
    evaluators: {},
    scenarios: noOutcomes(),
    scenarioFailures: {},
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
    repositories: {},
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
  if (counts[key] === undefined && Object.keys(counts).length >= cap) return counts;
  return { ...counts, [key]: (counts[key] ?? 0) + by };
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

export function latencyBucketOf(durationMs: number): number {
  const index = LATENCY_BUCKETS_MS.findIndex((bound) => durationMs <= bound);
  return index === -1 ? LATENCY_BUCKETS_MS.length : index;
}

/** A percentile read off the histogram: the upper bound of the bucket it lands in. */
export function latencyPercentile({
  latency,
  percentile,
}: {
  latency: readonly number[];
  percentile: number;
}): number {
  const total = latency.reduce((sum, count) => sum + count, 0);
  if (total === 0) return 0;
  const target = Math.ceil((percentile / 100) * total);
  let seen = 0;
  for (const [index, count] of latency.entries()) {
    seen += count;
    if (seen >= target) return LATENCY_BUCKETS_MS[index] ?? LATENCY_BUCKETS_MS.at(-1) ?? 0;
  }
  return LATENCY_BUCKETS_MS.at(-1) ?? 0;
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
  };
}
