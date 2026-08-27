/**
 * The run plans of a project, and the small numbers their rows read.
 *
 * A run plan is anything a person can open to read runs: a test suite, an
 * external set that a code run writes into, or the one-off runs of the
 * project. All three are addressed by a slug and all three point at one
 * scenario set, so the rest of the Results tab reads one shape.
 *
 * Everything here is pure, so the list rules can be read and tested without a
 * router or a query.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 * @see specs/suites/one-off-runs-surface.feature
 */

import type { RunGroupSummary } from "~/components/suites/run-history-transforms";
import {
  EXTERNAL_SET_PREFIX,
  isExternalSetSelection,
} from "~/components/suites/useSuiteRouting";
import {
  getOnPlatformSetId,
  isOnPlatformSet,
} from "~/server/scenarios/internal-set-id";
import type {
  ExternalSetSummary,
  ScenarioRunData,
  SuiteRunSummary,
} from "@langwatch/scenario-contract";
import { getSuiteSetId } from "@langwatch/suite-contract";
import {
  ONE_OFF_RUNS_PLAN_SLUG,
  RESULTS_SEGMENT,
} from "../useAgentTestingRouting";

/** What the one-off run plan reads as in the v2 interface. */
export const ONE_OFF_RUNS_DISPLAY_NAME = "One-off runs";

/**
 * The label the command line puts on the throwaway suite it makes for
 * `scenario run`. Those suites are deleted again, so they never belong in a
 * list of run plans a person keeps.
 */
export const CLI_EPHEMERAL_LABEL = "cli-ephemeral";

export type RunPlanKind = "suite" | "external" | "one-off";

/** How the last run of a plan went, in the shape every source can supply. */
export type RunPlanLastRun = {
  passedCount: number;
  failedCount: number;
  /** Runs that reached a verdict, which is the pass rate denominator. */
  settledCount: number;
  lastRunTimestamp: number | null;
};

export type RunPlan = {
  /** The address segment the plan is opened by. */
  slug: string;
  name: string;
  kind: RunPlanKind;
  scenarioSetId: string;
  /** The suite the plan was made from, when it is one. */
  suiteId: string | null;
  /** How many test cases the plan holds, or null when only the code that ran knows. */
  caseCount: number | null;
  lastRun: RunPlanLastRun | null;
};

/**
 * The line under the name of a run plan, which says what the plan covers.
 *
 * A test suite runs the cases filed under it. An external set runs whatever
 * the code that pushed it ran. One-off runs is not a plan at all: it is where
 * a single case lands when it is run on its own.
 */
export function planScopeNote(kind: RunPlanKind): string {
  if (kind === "external") return "External set · runs from code";
  if (kind === "one-off") return "Single test cases, run one at a time";
  return "Test suite";
}

/** The suite fields a run plan is built from. */
export type RunPlanSuite = {
  id: string;
  name: string;
  slug: string;
  scenarioIds: string[];
  labels: string[];
};

/** The address segment an external set is opened by. */
export function toExternalPlanSlug(scenarioSetId: string): string {
  return `${EXTERNAL_SET_PREFIX}${scenarioSetId}`;
}

/**
 * The Agent Testing address that shows the run a v1 handoff names.
 *
 * The SDK hands a tab a `/simulations/:scenarioSetId/:batchRunId` address,
 * built on the server from ids. A reader of the v2 interface belongs on the
 * run of the plan that set is read as, not on the v1 page.
 *
 * Returns null for anything that is not a v1 run address, so the caller can
 * follow it as it stands.
 *
 * @see specs/features/agent-testing/page-structure.feature
 */
export function toAgentTestingRunPath(pathname: string): string | null {
  const match = pathname.match(/^\/([^/]+)\/simulations\/([^/]+)\/([^/]+)\/?$/);
  if (!match) return null;

  const [, projectSlug, rawSetId, batchRunId] = match;
  if (!projectSlug || !rawSetId || !batchRunId) return null;

  const scenarioSetId = decodeURIComponent(rawSetId);
  const planSlug = isOnPlatformSet(scenarioSetId)
    ? ONE_OFF_RUNS_PLAN_SLUG
    : toExternalPlanSlug(scenarioSetId);

  return `/${projectSlug}/agent-testing/${RESULTS_SEGMENT}/${planSlug}/${batchRunId}`;
}

function toLastRun(
  summary: Pick<
    SuiteRunSummary,
    "passedCount" | "failedCount" | "totalCount" | "lastRunTimestamp"
  >,
): RunPlanLastRun {
  return {
    passedCount: summary.passedCount,
    failedCount: summary.failedCount,
    settledCount: summary.totalCount,
    lastRunTimestamp: summary.lastRunTimestamp,
  };
}

/** Newest first, and a plan that never ran sits under the ones that did. */
function byLastRunDesc(a: RunPlan, b: RunPlan): number {
  const left = a.lastRun?.lastRunTimestamp ?? null;
  const right = b.lastRun?.lastRunTimestamp ?? null;
  if (left === right) return a.name.localeCompare(b.name);
  if (left === null) return 1;
  if (right === null) return -1;
  return right - left;
}

/**
 * Every run plan of a project, one-off runs last.
 *
 * One-off runs are not a plan anyone wrote, so they sit under the plans that
 * were, however recently they ran.
 */
export function buildRunPlans({
  projectId,
  suites,
  suiteSummaries,
  externalSets,
  oneOffLastRun,
}: {
  projectId: string;
  suites: RunPlanSuite[];
  /** Keyed by suite id, as suites.getSummaries returns them. */
  suiteSummaries: Record<string, SuiteRunSummary>;
  externalSets: ExternalSetSummary[];
  oneOffLastRun: RunPlanLastRun | null;
}): RunPlan[] {
  const suitePlans: RunPlan[] = suites
    .filter((suite) => !suite.labels.includes(CLI_EPHEMERAL_LABEL))
    .map((suite) => {
      const summary = suiteSummaries[suite.id];
      return {
        slug: suite.slug,
        name: suite.name,
        kind: "suite" as const,
        scenarioSetId: getSuiteSetId(suite.id),
        suiteId: suite.id,
        caseCount: suite.scenarioIds.length,
        lastRun: summary ? toLastRun(summary) : null,
      };
    });

  const externalPlans: RunPlan[] = externalSets.map((set) => ({
    slug: toExternalPlanSlug(set.scenarioSetId),
    name: set.scenarioSetId,
    kind: "external" as const,
    scenarioSetId: set.scenarioSetId,
    suiteId: null,
    caseCount: null,
    lastRun: toLastRun(set),
  }));

  const oneOffPlan: RunPlan = {
    slug: ONE_OFF_RUNS_PLAN_SLUG,
    name: ONE_OFF_RUNS_DISPLAY_NAME,
    kind: "one-off",
    scenarioSetId: getOnPlatformSetId(projectId),
    suiteId: null,
    caseCount: null,
    lastRun: oneOffLastRun,
  };

  return [...suitePlans, ...externalPlans]
    .sort(byLastRunDesc)
    .concat(oneOffPlan);
}

/**
 * The plan an address names, resolved without waiting for the suite list when
 * the address already carries everything the plan needs.
 */
export function resolveRunPlan({
  plans,
  planSlug,
  projectId,
}: {
  plans: RunPlan[];
  planSlug: string;
  projectId: string;
}): RunPlan | null {
  const known = plans.find((plan) => plan.slug === planSlug);
  if (known) return known;

  if (planSlug === ONE_OFF_RUNS_PLAN_SLUG) {
    return {
      slug: ONE_OFF_RUNS_PLAN_SLUG,
      name: ONE_OFF_RUNS_DISPLAY_NAME,
      kind: "one-off",
      scenarioSetId: getOnPlatformSetId(projectId),
      suiteId: null,
      caseCount: null,
      lastRun: null,
    };
  }

  if (isExternalSetSelection(planSlug)) {
    const scenarioSetId = planSlug.slice(EXTERNAL_SET_PREFIX.length);
    return {
      slug: planSlug,
      name: scenarioSetId,
      kind: "external",
      scenarioSetId,
      suiteId: null,
      caseCount: null,
      lastRun: null,
    };
  }

  return null;
}

/**
 * A last run in the shape the run summary pills read. Duration and cost are
 * absent because the aggregate queries that feed a plan row do not carry them.
 */
export function toRunGroupSummary(lastRun: RunPlanLastRun): RunGroupSummary {
  const settledCount = lastRun.settledCount;
  return {
    passRate:
      settledCount > 0 ? (lastRun.passedCount / settledCount) * 100 : null,
    passedCount: lastRun.passedCount,
    failedCount: lastRun.failedCount,
    stalledCount: 0,
    cancelledCount: 0,
    completedCount: lastRun.passedCount + lastRun.failedCount,
    totalCount: settledCount,
    inProgressCount: 0,
    queuedCount: 0,
    totalCost: null,
    averageAgentLatencyMs: null,
    totalDurationMs: null,
    agentLatencyStats: null,
    agentCostStats: null,
    averageAgentCost: null,
  };
}

/**
 * The number a run reads by inside its window.
 *
 * The newest run of the window is the last one that happened in it, so the
 * count of runs in the window names it. Older runs count down from there.
 * When the total is not known yet, the loaded runs are the best answer.
 *
 * The loaded runs are also the floor of the count. A run that has just
 * finished is in the list before the count query has read it again, and a
 * count lower than the list would name two runs the same.
 */
export function runOrdinal({
  index,
  totalCount,
  loadedCount,
}: {
  /** Position in the list, newest first. */
  index: number;
  /** Runs in the window, as the server counts them. */
  totalCount: number | null;
  /** Runs fetched so far. */
  loadedCount: number;
}): number {
  const highest = Math.max(totalCount ?? 0, loadedCount);
  return Math.max(highest - index, 1);
}

/**
 * The note a batch carries, or nothing. Every run of a batch carries the same
 * note, so the first run that has one answers for the batch.
 *
 * @see specs/suites/run-notes.feature
 */
export function batchNote(scenarioRuns: ScenarioRunData[]): string | null {
  for (const run of scenarioRuns) {
    const note = run.metadata?.note?.trim();
    if (note) return note;
  }
  return null;
}

/**
 * What a one-off run reads as: the test case that ran. A one-off batch holds
 * one run, so its case names the batch.
 *
 * @see specs/suites/one-off-runs-surface.feature
 */
export function oneOffRunTitle(scenarioRuns: ScenarioRunData[]): string | null {
  const first = scenarioRuns[0];
  if (!first) return null;
  return first.name ?? first.scenarioId;
}

/** The window a run outside the current one needs, in days. */
export function widenedWindowDays(
  lastRunTimestamp: number,
  now: number,
): 30 | 90 | 365 {
  const daysAgo = Math.ceil((now - lastRunTimestamp) / 86_400_000);
  if (daysAgo <= 30) return 30;
  if (daysAgo <= 90) return 90;
  return 365;
}
