// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** The two weekly folds, Postgres-held (`.withPostgresProjection`), keyed by aggregate. */
import type { StateProjectionDefinition, StateProjectionStore } from "@langwatch/eventing";

import {
  addOutcome,
  countCapped,
  emptyProjectWeek,
  emptyUserWeek,
  latencyBucketOf,
  MAX_EVALUATORS,
  MAX_MODELS,
  MAX_REPOSITORIES,
  MAX_SCENARIOS,
  MAX_SERIES,
  MAX_SESSIONS,
  type ProjectWeekState,
  type UserWeekState,
} from "../rules/digest-week.rules.ts";
import {
  DIGEST_ACTIVITY_COALESCE_MAX_BATCH,
  DIGEST_EVENT_VERSION,
  type DigestEvent,
  PROJECT_ACTIVITY_RECORDED_EVENT_TYPE,
  type ProjectActivity,
  type ProjectFact,
  USER_ACTIVITY_RECORDED_EVENT_TYPE,
  type UserActivity,
} from "./digest-activity.events.ts";

type FactOf<Kind extends ProjectFact["kind"]> = Extract<ProjectFact, { kind: Kind }>;

export function applyProjectActivity({
  state,
  activity,
}: {
  state: ProjectWeekState;
  activity: ProjectActivity;
}): ProjectWeekState {
  const next: ProjectWeekState = {
    ...state,
    projectId: activity.projectId,
    organizationId: activity.organizationId,
    isoWeek: activity.isoWeek,
  };
  const fact = activity.fact;
  switch (fact.kind) {
    case "span":
      return applySpan({ state: next, fact });
    case "evaluation":
      return applyEvaluation({ state: next, fact });
    case "scenario":
      return applyScenario({ state: next, fact });
  }
}

function applySpan({
  state,
  fact,
}: {
  state: ProjectWeekState;
  fact: FactOf<"span">;
}): ProjectWeekState {
  const bucket = latencyBucketOf(fact.durationMs);
  return {
    ...state,
    spans: state.spans + 1,
    traces: state.traces + (fact.root ? 1 : 0),
    errors: state.errors + (fact.error ? 1 : 0),
    tokens: state.tokens + fact.tokens,
    costUsd: state.costUsd + fact.costUsd,
    latency: state.latency.map((count, index) =>
      fact.root && index === bucket ? count + 1 : count,
    ),
    models: fact.model
      ? countCapped({ counts: state.models, key: fact.model, cap: MAX_MODELS })
      : state.models,
  };
}

function applyEvaluation({
  state,
  fact,
}: {
  state: ProjectWeekState;
  fact: FactOf<"evaluation">;
}): ProjectWeekState {
  const evaluations = addOutcome({ counts: state.evaluations, outcome: fact.outcome });
  const evaluator = fact.evaluatorType ?? "custom";
  // Own keys only: an evaluator named `constructor` must not read the prototype's.
  const known = Object.hasOwn(state.evaluators, evaluator)
    ? state.evaluators[evaluator]
    : undefined;
  if (known === undefined && Object.keys(state.evaluators).length >= MAX_EVALUATORS) {
    return { ...state, evaluations };
  }
  return {
    ...state,
    evaluations,
    evaluators: {
      ...state.evaluators,
      [evaluator]: addOutcome({
        counts: known ?? { runs: 0, passed: 0, failed: 0 },
        outcome: fact.outcome,
      }),
    },
  };
}

function applyScenario({
  state,
  fact,
}: {
  state: ProjectWeekState;
  fact: FactOf<"scenario">;
}): ProjectWeekState {
  const scenarios = addOutcome({ counts: state.scenarios, outcome: fact.outcome });
  if (fact.outcome !== "failed" || !fact.scenarioId) return { ...state, scenarios };
  return {
    ...state,
    scenarios,
    scenarioFailures: countCapped({
      counts: state.scenarioFailures,
      key: fact.scenarioId,
      cap: MAX_SCENARIOS,
    }),
  };
}

export function applyUserActivity({
  state,
  activity,
}: {
  state: UserWeekState;
  activity: UserActivity;
}): UserWeekState {
  const seen = state.sessions.includes(activity.sessionId);
  const room = state.sessions.length < MAX_SESSIONS;
  const series = activity.series;
  const seriesFits =
    series !== null &&
    (state.series[series.seriesId] !== undefined || Object.keys(state.series).length < MAX_SERIES);
  return {
    userId: activity.userId,
    organizationId: activity.organizationId,
    isoWeek: activity.isoWeek,
    sessions: seen || !room ? state.sessions : [...state.sessions, activity.sessionId],
    // ponytail: past the cap a session is counted per fact, not per id; raise MAX_SESSIONS if it bites.
    sessionOverflow: state.sessionOverflow + (!seen && !room ? 1 : 0),
    series:
      series && seriesFits
        ? {
            ...state.series,
            [series.seriesId]: { metric: series.metric, type: series.type, value: series.value },
          }
        : state.series,
    repositories:
      activity.repository && !seen
        ? countCapped({
            counts: state.repositories,
            key: activity.repository,
            cap: MAX_REPOSITORIES,
          })
        : state.repositories,
  };
}

export function projectWeekProjection({
  store,
}: {
  store: StateProjectionStore<ProjectWeekState>;
}): StateProjectionDefinition<ProjectWeekState, DigestEvent> {
  return {
    name: "digestProjectWeek",
    version: DIGEST_EVENT_VERSION,
    eventTypes: [PROJECT_ACTIVITY_RECORDED_EVENT_TYPE],
    init: emptyProjectWeek,
    apply: (state, event) =>
      event.type === PROJECT_ACTIVITY_RECORDED_EVENT_TYPE
        ? applyProjectActivity({ state, activity: event.data })
        : state,
    store,
    options: { coalesceMaxBatch: DIGEST_ACTIVITY_COALESCE_MAX_BATCH },
  };
}

export function userWeekProjection({
  store,
}: {
  store: StateProjectionStore<UserWeekState>;
}): StateProjectionDefinition<UserWeekState, DigestEvent> {
  return {
    name: "digestUserWeek",
    version: DIGEST_EVENT_VERSION,
    eventTypes: [USER_ACTIVITY_RECORDED_EVENT_TYPE],
    init: emptyUserWeek,
    apply: (state, event) =>
      event.type === USER_ACTIVITY_RECORDED_EVENT_TYPE
        ? applyUserActivity({ state, activity: event.data })
        : state,
    store,
    options: { coalesceMaxBatch: DIGEST_ACTIVITY_COALESCE_MAX_BATCH },
  };
}
