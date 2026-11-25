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
  // Models count calls, not traces: the LLM call is usually a child span, rarely the root.
  const usage = {
    ...state,
    tokens: state.tokens + fact.tokens,
    costUsd: state.costUsd + fact.costUsd,
    models: fact.model
      ? countCapped({ counts: state.models, key: fact.model, cap: MAX_MODELS })
      : state.models,
  };
  // Errors and latency are per trace, read off its root span, so neither can outgrow `traces`.
  if (!fact.root) return usage;
  const bucket = latencyBucketOf(fact.durationMs);
  return {
    ...usage,
    traces: state.traces + 1,
    errors: state.errors + (fact.error ? 1 : 0),
    latency: state.latency.map((count, index) => (index === bucket ? count + 1 : count)),
  };
}

function applyEvaluation({
  state,
  fact,
}: {
  state: ProjectWeekState;
  fact: FactOf<"evaluation">;
}): ProjectWeekState {
  const evaluator = fact.evaluatorType ?? "custom";
  // Own keys only: an evaluator named `constructor` must not read the prototype's.
  const known = Object.hasOwn(state.evaluators, evaluator)
    ? state.evaluators[evaluator]
    : undefined;
  if (known === undefined && Object.keys(state.evaluators).length >= MAX_EVALUATORS) {
    return state;
  }
  return {
    ...state,
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
  return { ...state, scenarios: addOutcome({ counts: state.scenarios, outcome: fact.outcome }) };
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
    (Object.hasOwn(state.series, series.seriesId) || Object.keys(state.series).length < MAX_SERIES);
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
    // Counted, never summed: the fold cannot tell a delta point from a cumulative reading, and
    // re-adding a cumulative reading would over-count. The email reads the totals as floors.
    seriesOverflow: state.seriesOverflow + (series !== null && !seriesFits ? 1 : 0),
    ...applyRepository({ state, sessionId: activity.sessionId, repository: activity.repository }),
  };
}

/**
 * Counts a session's repository once, on the first fact that names one: a metric fact carries
 * none, so it may well land before the span that does.
 */
function applyRepository({
  state,
  sessionId,
  repository,
}: {
  state: UserWeekState;
  sessionId: string;
  repository: string | null;
}): Pick<UserWeekState, "repositories" | "sessionRepositories"> {
  const { repositories, sessionRepositories } = state;
  if (!repository || Object.hasOwn(sessionRepositories, sessionId)) {
    return { repositories, sessionRepositories };
  }
  const bindingFits = Object.keys(sessionRepositories).length < MAX_SESSIONS;
  return {
    repositories: countCapped({ counts: repositories, key: repository, cap: MAX_REPOSITORIES }),
    // Past the cap, a session's repository counts per fact, as sessionOverflow does.
    sessionRepositories: bindingFits
      ? { ...sessionRepositories, [sessionId]: repository }
      : sessionRepositories,
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
