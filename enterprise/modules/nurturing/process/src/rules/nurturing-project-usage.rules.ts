// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { CioOrgTraits } from "@langwatch/enterprise-nurturing-contract";
import { Temporal } from "@langwatch/time";
import { z } from "zod";

import { unixSecondsOf } from "./nurturing-customer-io-timestamp.rules.ts";
import { utcDayOf } from "./nurturing-time.rules.ts";
import type { NurturingTraceCounts } from "./nurturing-trace-day.rules.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far back traces, errors and active days are counted. */
export const PROJECT_USAGE_WINDOW_MS = 30 * DAY_MS;

/** The free window the per-email journey speaks of, from the organization's creation. */
export const PROJECT_USAGE_TRIAL_WINDOW_MS = 14 * DAY_MS;

/** One project's prompt, evaluator and scenario usage as nurturing folds it from the owners. */
export const nurturingProjectUsageStateSchema = z.object({
  projectId: z.string(),
  promptIds: z.array(z.string()),
  evaluatorIds: z.array(z.string()),
  /** The highest per-project count a scenario.created fact carried. */
  scenarioCount: z.number(),
  hasScenarioRun: z.boolean(),
  /** The user simulation sets the project ran, each once. */
  simulationSetIds: z.array(z.string()),
  /**
   * UTC days with a habit activity (a prompt version, a finished scenario run, an evaluation),
   * within the window of the newest fact folded, ascending. Traces' days are their own rows.
   */
  activeDays: z.array(z.string()),
  LastEventOccurredAt: z.number(),
});
export type NurturingProjectUsageState = z.infer<typeof nurturingProjectUsageStateSchema>;

/** A fact the fold takes, reduced to what it counts. */
export type NurturingProjectUsageFact = Readonly<{ occurredAt: number }> &
  (
    | Readonly<{ kind: "prompt_created" | "prompt_deleted"; promptId: string }>
    | Readonly<{ kind: "prompt_version_saved" }>
    | Readonly<{ kind: "evaluator_created" | "evaluator_deleted"; evaluatorId: string }>
    | Readonly<{ kind: "scenario_created"; scenarioCount: number }>
    | Readonly<{ kind: "simulation_set_created"; scenarioSetId: string }>
    | Readonly<{ kind: "scenario_run" }>
    | Readonly<{ kind: "evaluation_completed" }>
  );

/** The UTC day the window starts after: a day after it is fully inside the window. */
export function windowStartDayOf(now: number): string {
  return utcDayOf(now - PROJECT_USAGE_WINDOW_MS);
}

/** The days after signup whose activity is a trait, `active_day_<n>`. */
const TRACKED_SIGNUP_DAYS = [0, 1, 12, 13] as const;
type SignupDayTraits = Pick<CioOrgTraits, `active_day_${(typeof TRACKED_SIGNUP_DAYS)[number]}`>;

/** A habit takes this many distinct active days, or this many distinct active ISO weeks. */
const HABIT_MIN_ACTIVE = 3;
/** ... the days' first and last this many days apart at least. */
const HABIT_MIN_SPAN_DAYS = 7;

const epochOfDay = (day: string) => Temporal.Instant.from(`${day}T00:00:00Z`).epochMilliseconds;

/** The ISO week a UTC day falls in, `YYYY-Www`. */
function isoWeekOf(day: string): string {
  const date = Temporal.PlainDate.from(day);
  return `${date.yearOfWeek}-W${date.weekOfYear}`;
}

/**
 * The review app's value-map rule: activity on 3 or more distinct days whose first and last are
 * at least 7 days apart, or activity in 3 or more distinct ISO weeks.
 */
function hasHabit(activeDays: readonly string[]): boolean {
  if (activeDays.length < HABIT_MIN_ACTIVE) return false;
  const times = activeDays.map(epochOfDay);
  const spreadOverAWeek = (Math.max(...times) - Math.min(...times)) / DAY_MS >= HABIT_MIN_SPAN_DAYS;
  return spreadOverAWeek || new Set(activeDays.map(isoWeekOf)).size >= HABIT_MIN_ACTIVE;
}

/**
 * `active_day_<n>` for each tracked day still fully inside the window. A day that left it is
 * omitted, not false: its traces were pruned, and Customer.io keeps the value it last had.
 */
function signupDayTraits({
  activeDays,
  organizationCreatedAt,
  windowStartDay,
}: Readonly<{
  activeDays: readonly string[];
  organizationCreatedAt: number;
  windowStartDay: string;
}>): SignupDayTraits {
  const traits: SignupDayTraits = {};
  for (const n of TRACKED_SIGNUP_DAYS) {
    const day = utcDayOf(organizationCreatedAt + n * DAY_MS);
    if (day > windowStartDay) traits[`active_day_${n}` as const] = activeDays.includes(day);
  }
  return traits;
}

export function emptyProjectUsage(projectId: string): NurturingProjectUsageState {
  return {
    projectId,
    promptIds: [],
    evaluatorIds: [],
    scenarioCount: 0,
    hasScenarioRun: false,
    simulationSetIds: [],
    activeDays: [],
    LastEventOccurredAt: 0,
  };
}

/**
 * The fact's UTC day added to the habit activity, and days older than the window, measured from the
 * newest fact folded, dropped, so a row holds at most 31 days whatever the project does.
 */
function withActiveDay(
  state: NurturingProjectUsageState,
  occurredAt: number,
): NurturingProjectUsageState {
  const day = utcDayOf(occurredAt);
  const firstDay = utcDayOf(Math.max(state.LastEventOccurredAt - PROJECT_USAGE_WINDOW_MS, 0));
  const days = state.activeDays.includes(day) ? state.activeDays : [...state.activeDays, day];
  return { ...state, activeDays: days.filter((known) => known >= firstDay).toSorted() };
}

function withId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? [...ids] : [...ids, id];
}

function withoutId(ids: readonly string[], id: string): string[] {
  return ids.filter((known) => known !== id);
}

/** Folds one fact into the project's usage; pure, so a replay rebuilds the same row. */
export function foldProjectUsage(
  state: NurturingProjectUsageState,
  fact: NurturingProjectUsageFact,
): NurturingProjectUsageState {
  const base = {
    ...state,
    LastEventOccurredAt: Math.max(state.LastEventOccurredAt, fact.occurredAt),
  };
  switch (fact.kind) {
    case "prompt_created":
      return withActiveDay(
        { ...base, promptIds: withId(state.promptIds, fact.promptId) },
        fact.occurredAt,
      );
    case "prompt_version_saved":
    case "evaluation_completed":
      return withActiveDay(base, fact.occurredAt);
    case "prompt_deleted":
      return { ...base, promptIds: withoutId(state.promptIds, fact.promptId) };
    case "evaluator_created":
      return { ...base, evaluatorIds: withId(state.evaluatorIds, fact.evaluatorId) };
    case "evaluator_deleted":
      return { ...base, evaluatorIds: withoutId(state.evaluatorIds, fact.evaluatorId) };
    case "scenario_created":
      return { ...base, scenarioCount: Math.max(state.scenarioCount, fact.scenarioCount) };
    case "simulation_set_created":
      return { ...base, simulationSetIds: withId(state.simulationSetIds, fact.scenarioSetId) };
    case "scenario_run":
      return withActiveDay({ ...base, hasScenarioRun: true }, fact.occurredAt);
  }
}

/** The trace traits, from nurturing's own trace days. */
function traceTraits({
  traces,
  otherActiveDays,
  now,
  organizationCreatedAt,
}: Readonly<{
  traces: NurturingTraceCounts;
  /** The projects' prompt-version, scenario-run and evaluation days. */
  otherActiveDays: readonly string[];
  now: number;
  organizationCreatedAt: number | null;
}>): Partial<CioOrgTraits> {
  const { lastTraceAt, lastFailedTraceAt, activeDays } = traces;
  const windowStartDay = windowStartDayOf(now);
  const habitDays = [
    ...new Set([...activeDays, ...otherActiveDays.filter((day) => day > windowStartDay)]),
  ];
  // The newest trace's day answers both day traits: some day is after X exactly when it is.
  const lastTraceDay = lastTraceAt === null ? null : utcDayOf(lastTraceAt);
  return {
    trace_count: traces.traceCount,
    error_count: traces.errorCount,
    ...(lastTraceAt !== null && { last_trace_date: unixSecondsOf(lastTraceAt) }),
    ...(lastFailedTraceAt !== null && { last_failed_trace_at: unixSecondsOf(lastFailedTraceAt) }),
    active_last_7_days: lastTraceDay !== null && lastTraceDay >= utcDayOf(now - 6 * DAY_MS),
    has_habit: hasHabit(habitDays),
    ...(organizationCreatedAt !== null && {
      back_since_day_0: lastTraceDay !== null && lastTraceDay > utcDayOf(organizationCreatedAt),
      ...signupDayTraits({ activeDays, organizationCreatedAt, windowStartDay }),
    }),
  };
}

/**
 * The organization's per-email traits from its projects' usage and trace days at `now`. Counts and
 * times only, never content; flagged_count waits on its definition.
 */
export function organizationUsageTraits({
  projects,
  traces,
  now,
  organizationCreatedAt,
}: Readonly<{
  projects: readonly NurturingProjectUsageState[];
  traces: NurturingTraceCounts;
  now: number;
  organizationCreatedAt: number | null;
}>): Partial<CioOrgTraits> {
  return {
    prompt_count: projects.reduce((sum, project) => sum + project.promptIds.length, 0),
    evaluator_count: projects.reduce((sum, project) => sum + project.evaluatorIds.length, 0),
    scenario_count: projects.reduce((sum, project) => sum + project.scenarioCount, 0),
    simulation_set_count: projects.reduce(
      (sum, project) => sum + project.simulationSetIds.length,
      0,
    ),
    has_scenario_run: projects.some((project) => project.hasScenarioRun),
    ...(organizationCreatedAt !== null && {
      window_end_date: unixSecondsOf(organizationCreatedAt + PROJECT_USAGE_TRIAL_WINDOW_MS),
    }),
    ...traceTraits({
      traces,
      otherActiveDays: projects.flatMap((project) => project.activeDays),
      now,
      organizationCreatedAt,
    }),
  };
}
