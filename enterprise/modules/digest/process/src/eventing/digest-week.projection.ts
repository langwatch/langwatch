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
  USER_ACTIVITY_RECORDED_EVENT_TYPE,
  type UserActivity,
} from "./digest-activity.events.ts";

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
    case "span": {
      const bucket = latencyBucketOf(fact.durationMs);
      const latency = next.latency.map((count, index) =>
        fact.root && index === bucket ? count + 1 : count,
      );
      return {
        ...next,
        spans: next.spans + 1,
        traces: next.traces + (fact.root ? 1 : 0),
        errors: next.errors + (fact.error ? 1 : 0),
        tokens: next.tokens + fact.tokens,
        costUsd: next.costUsd + fact.costUsd,
        latency,
        models: fact.model
          ? countCapped({ counts: next.models, key: fact.model, cap: MAX_MODELS })
          : next.models,
      };
    }
    case "evaluation": {
      const evaluator = fact.evaluatorType ?? "custom";
      const known = next.evaluators[evaluator];
      const capped = known === undefined && Object.keys(next.evaluators).length >= MAX_EVALUATORS;
      return {
        ...next,
        evaluations: addOutcome({ counts: next.evaluations, outcome: fact.outcome }),
        evaluators: capped
          ? next.evaluators
          : {
              ...next.evaluators,
              [evaluator]: addOutcome({
                counts: known ?? { runs: 0, passed: 0, failed: 0 },
                outcome: fact.outcome,
              }),
            },
      };
    }
    case "scenario":
      return {
        ...next,
        scenarios: addOutcome({ counts: next.scenarios, outcome: fact.outcome }),
        scenarioFailures:
          fact.outcome === "failed" && fact.scenarioId
            ? countCapped({ counts: next.scenarioFailures, key: fact.scenarioId, cap: MAX_SCENARIOS })
            : next.scenarioFailures,
      };
    case "suiteItem":
      return { ...next, suiteItems: addOutcome({ counts: next.suiteItems, outcome: fact.outcome }) };
  }
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
