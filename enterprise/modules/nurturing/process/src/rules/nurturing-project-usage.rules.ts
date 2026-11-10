// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { CioOrgTraits } from "@langwatch/enterprise-nurturing-contract";
import { z } from "zod";

import { unixSecondsOf } from "./nurturing-customer-io-timestamp.rules.ts";
import { utcDayOf } from "./nurturing-time.rules.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far back traces, errors, cost and active days are counted. */
export const PROJECT_USAGE_WINDOW_MS = 30 * DAY_MS;

/** The free window the per-email journey speaks of, from the organization's creation. */
export const PROJECT_USAGE_TRIAL_WINDOW_MS = 14 * DAY_MS;

const traceUsageSchema = z.object({
  /** Business time of the trace's latest received fact, epoch ms. */
  at: z.number(),
  error: z.boolean(),
  /** USD; null when the trace is not priced. */
  cost: z.number().nullable(),
});

/** One project's usage as nurturing folds it from the owners' events. */
export const nurturingProjectUsageStateSchema = z.object({
  projectId: z.string(),
  promptIds: z.array(z.string()),
  evaluatorIds: z.array(z.string()),
  /** The highest per-project count a scenario.created fact carried. */
  scenarioCount: z.number(),
  hasScenarioRun: z.boolean(),
  /** The latest value per trace id, within the window. */
  traces: z.record(z.string(), traceUsageSchema),
  /** UTC days on which a trace arrived, within the window, ascending. */
  activeDays: z.array(z.string()),
  LastEventOccurredAt: z.number(),
});
export type NurturingProjectUsageState = z.infer<typeof nurturingProjectUsageStateSchema>;

/** A fact the fold takes, reduced to what it counts. */
export type NurturingProjectUsageFact = Readonly<{ occurredAt: number }> &
  (
    | Readonly<{ kind: "prompt_created" | "prompt_deleted"; promptId: string }>
    | Readonly<{ kind: "evaluator_created" | "evaluator_deleted"; evaluatorId: string }>
    | Readonly<{ kind: "scenario_created"; scenarioCount: number }>
    | Readonly<{ kind: "scenario_run" }>
    | Readonly<{
        kind: "trace_received";
        traceId: string | null;
        containsErrorStatus: boolean;
        totalCost: number | null;
      }>
  );

export function emptyProjectUsage(projectId: string): NurturingProjectUsageState {
  return {
    projectId,
    promptIds: [],
    evaluatorIds: [],
    scenarioCount: 0,
    hasScenarioRun: false,
    traces: {},
    activeDays: [],
    LastEventOccurredAt: 0,
  };
}

function withId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? [...ids] : [...ids, id];
}

function withoutId(ids: readonly string[], id: string): string[] {
  return ids.filter((known) => known !== id);
}

/** Traces and days older than the window, measured from the newest fact folded, drop out. */
function withinWindow(state: NurturingProjectUsageState): NurturingProjectUsageState {
  const since = state.LastEventOccurredAt - PROJECT_USAGE_WINDOW_MS;
  const firstDay = utcDayOf(Math.max(since, 0));
  return {
    ...state,
    traces: Object.fromEntries(Object.entries(state.traces).filter(([, trace]) => trace.at >= since)),
    activeDays: state.activeDays.filter((day) => day >= firstDay),
  };
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
      return { ...base, promptIds: withId(state.promptIds, fact.promptId) };
    case "prompt_deleted":
      return { ...base, promptIds: withoutId(state.promptIds, fact.promptId) };
    case "evaluator_created":
      return { ...base, evaluatorIds: withId(state.evaluatorIds, fact.evaluatorId) };
    case "evaluator_deleted":
      return { ...base, evaluatorIds: withoutId(state.evaluatorIds, fact.evaluatorId) };
    case "scenario_created":
      return { ...base, scenarioCount: Math.max(state.scenarioCount, fact.scenarioCount) };
    case "scenario_run":
      return { ...base, hasScenarioRun: true };
    case "trace_received": {
      const day = utcDayOf(fact.occurredAt);
      const activeDays = state.activeDays.includes(day)
        ? state.activeDays
        : [...state.activeDays, day].sort();
      // A fact from before trace_received carried its trace id counts as an active day only.
      const traces =
        fact.traceId === null
          ? state.traces
          : {
              ...state.traces,
              [fact.traceId]: {
                at: Math.max(state.traces[fact.traceId]?.at ?? 0, fact.occurredAt),
                error: fact.containsErrorStatus,
                cost: fact.totalCost,
              },
            };
      return withinWindow({ ...base, activeDays, traces });
    }
  }
}

/**
 * The organization's per-email traits, summed over its projects' usage at `now`. Counts and times
 * only, never content; flagged_count and has_habit wait on their definitions.
 */
export function organizationUsageTraits({
  projects,
  now,
  organizationCreatedAt,
}: Readonly<{
  projects: readonly NurturingProjectUsageState[];
  now: number;
  organizationCreatedAt: number | null;
}>): Partial<CioOrgTraits> {
  const since = now - PROJECT_USAGE_WINDOW_MS;
  const traces = projects.flatMap((project) =>
    Object.values(project.traces).filter((trace) => trace.at >= since),
  );
  const failedAt = traces.filter((trace) => trace.error).map((trace) => trace.at);
  const days = new Set(projects.flatMap((project) => project.activeDays));
  const lastWeekFrom = utcDayOf(now - 6 * DAY_MS);
  const totalCost = traces.reduce((sum, trace) => sum + (trace.cost ?? 0), 0);
  return {
    prompt_count: projects.reduce((sum, project) => sum + project.promptIds.length, 0),
    evaluator_count: projects.reduce((sum, project) => sum + project.evaluatorIds.length, 0),
    scenario_count: projects.reduce((sum, project) => sum + project.scenarioCount, 0),
    trace_count: traces.length,
    error_count: failedAt.length,
    total_cost: Math.round(totalCost * 100) / 100,
    ...(failedAt.length > 0 && { last_failed_trace_at: unixSecondsOf(Math.max(...failedAt)) }),
    has_scenario_run: projects.some((project) => project.hasScenarioRun),
    active_last_7_days: [...days].some((day) => day >= lastWeekFrom),
    ...(organizationCreatedAt === null
      ? {}
      : {
          back_since_day_0: [...days].some((day) => day > utcDayOf(organizationCreatedAt)),
          window_end_date: unixSecondsOf(organizationCreatedAt + PROJECT_USAGE_TRIAL_WINDOW_MS),
        }),
  };
}
