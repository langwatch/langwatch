/**
 * The run plans of a project, and the small numbers their rows read.
 * @see specs/features/agent-testing/results-tabs.feature
 */

import type { RunGroupSummary } from "@langwatch/suite-web";
import { EXTERNAL_SET_PREFIX, isExternalSetSelection } from "../../suites/use-suite-routing";
import { isOnPlatformSet } from "@langwatch/scenario-contract";
import type {
  ExternalSetSummary,
  ScenarioRunData,
  SuiteRunSummary,
} from "@langwatch/scenario-contract";
import { parseSuiteScope, getSuiteSetId } from "@langwatch/suite-contract";
import { RESULTS_SEGMENT } from "../use-agent-testing-routing";

/**
 * The label the command line puts on the throwaway suite it makes for
 * `scenario run`. Those suites are deleted again, so they never belong in a
 * list of run plans a person keeps.
 */
export const CLI_EPHEMERAL_LABEL = "cli-ephemeral";

/** The suite fields the run plan rule reads. */
export type StoredSuite = { kind?: string | null; labels: string[] };

/**
 * The suites of a project that are run plans.
 */
export function toRunPlanSuites<T extends StoredSuite>(suites: T[]): T[] {
  return suites.filter(
    (suite) => suite.kind !== "test_suite" && !suite.labels.includes(CLI_EPHEMERAL_LABEL),
  );
}

export type RunPlanKind = "suite" | "external";

/**
 * What a plan covers, as one word. The Scope column draws a mark for it, so a
 * plan that runs a suite is told from one that runs a label at a glance.
 */
export type RunPlanScopeKind = "all" | "test_suites" | "labels" | "scenarios" | "external";

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
  /** The stored plan row this was made from, and null for a set that runs from code. */
  suiteId: string | null;
  /** How many scenarios the plan holds, or null when only the code that ran knows. */
  caseCount: number | null;
  lastRun: RunPlanLastRun | null;
  /**
   * What the plan covers, in words, for the Scope column.
   */
  scopeLabel: string;
  /** What kind of scope that is, which is the mark drawn beside the label. */
  scopeKind: RunPlanScopeKind;
};

/**
 * The line under the name of a run plan, which says what the plan covers.
 *
 * An external set runs whatever the code that pushed it ran.
 */
export function planScopeNote(kind: RunPlanKind): string {
  if (kind === "external") return "External set · runs from code";
  return "Run plan";
}

/** The suite fields a run plan is built from. */
export type RunPlanSuite = {
  id: string;
  name: string;
  slug: string;
  scenarioIds: string[];
  labels: string[];
  /** The stored scope rule, as it crosses the wire: unparsed JSON. */
  scope?: unknown;
};

/**
 * What a run plan covers, in words.
 * @see specs/features/agent-testing/results-tabs.feature
 */
export function suiteScopeLabel({
  suite,
  suiteNames,
}: {
  suite: RunPlanSuite;
  /** Every test suite of the project, keyed by id, for a scope naming them. */
  suiteNames: ReadonlyMap<string, string>;
}): string {
  const scope = parseSuiteScope(suite.scope);
  switch (scope.mode) {
    case "all":
      return "All scenarios";
    case "test_suites": {
      const named = scope.testSuiteIds
        .map((id) => suiteNames.get(id))
        .filter((name): name is string => !!name);
      if (named.length === 0) return "No suite";
      return named.join(", ");
    }
    case "labels": {
      if (scope.labels.length === 0) return "No label";
      return `Labelled ${scope.labels.join(", ")}`;
    }
    case "scenarios": {
      const count = suite.scenarioIds.length;
      return count === 1 ? "1 scenario" : `${count} scenarios`;
    }
  }
}

/** Which kind of scope a stored plan holds. */
export function suiteScopeKind(suite: RunPlanSuite): RunPlanScopeKind {
  return parseSuiteScope(suite.scope).mode;
}

/** The address segment an external set is opened by. */
/**
 * How a set that runs from code reads wherever a plan states its scope or its
 * target. The code chose both, so both read the same way.
 */
export const CODE_RUN_LABEL = "From code";

/**
 * How the target of a run from code is named. The code pointed the run at its own
 * agent, so the platform holds no target for it, and the run reads under the default
 * target the same way a run without a set reads under the default set.
 */
export const CODE_TARGET_NAME = "default";

export function toExternalPlanSlug(scenarioSetId: string): string {
  return `${EXTERNAL_SET_PREFIX}${scenarioSetId}`;
}

/**
 * The Agent Testing address that shows the run a v1 handoff names.
 * @see specs/features/agent-testing/page-structure.feature
 */
export function toAgentTestingRunPath(pathname: string): string | null {
  const match = pathname.match(/^\/([^/]+)\/simulations\/([^/]+)\/([^/]+)\/?$/);
  if (!match) return null;

  const [, projectSlug, rawSetId, batchRunId] = match;
  if (!projectSlug || !rawSetId || !batchRunId) return null;

  const scenarioSetId = decodeURIComponent(rawSetId);
  if (isOnPlatformSet(scenarioSetId)) return null;
  const planSlug = toExternalPlanSlug(scenarioSetId);

  return `/${projectSlug}/agent-testing/${RESULTS_SEGMENT}/${planSlug}/${batchRunId}`;
}

function toLastRun(
  summary: Pick<SuiteRunSummary, "passedCount" | "failedCount" | "totalCount" | "lastRunTimestamp">,
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
 * Every run plan of a project, newest run first.
 */
export function buildRunPlans({
  plans,
  suiteNames,
  suiteSummaries,
  externalSets,
}: {
  /** The stored run plans, which are the plan rows and never the test suites. */
  plans: RunPlanSuite[];
  /** Every suite name of the project, keyed by id. */
  suiteNames: ReadonlyMap<string, string>;
  /** Keyed by suite id, as suites.getSummaries returns them. */
  suiteSummaries: Record<string, SuiteRunSummary>;
  externalSets: ExternalSetSummary[];
}): RunPlan[] {
  const suitePlans: RunPlan[] = toRunPlanSuites(plans).map((suite) => {
    const summary = suiteSummaries[suite.id];
    return {
      slug: suite.slug,
      name: suite.name,
      kind: "suite" as const,
      scenarioSetId: getSuiteSetId(suite.id),
      suiteId: suite.id,
      caseCount: suite.scenarioIds.length,
      lastRun: summary ? toLastRun(summary) : null,
      scopeLabel: suiteScopeLabel({ suite, suiteNames }),
      scopeKind: suiteScopeKind(suite),
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
    scopeLabel: CODE_RUN_LABEL,
    scopeKind: "external" as const,
  }));

  return [...suitePlans, ...externalPlans].sort(byLastRunDesc);
}

/**
 * The plan an address names, resolved without waiting for the suite list when
 * the address already carries everything the plan needs.
 */
export function resolveRunPlan({
  plans,
  planSlug,
}: {
  plans: RunPlan[];
  planSlug: string;
}): RunPlan | null {
  const known = plans.find((plan) => plan.slug === planSlug);
  if (known) return known;

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
      scopeLabel: CODE_RUN_LABEL,
      scopeKind: "external",
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
    passRate: settledCount > 0 ? (lastRun.passedCount / settledCount) * 100 : null,
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
 * The note a batch carries, or nothing. Every run of a batch carries the same note, so
 * the first run that has one answers for the batch.
 * @see specs/suites/run-notes.feature
 */
export function batchNote(scenarioRuns: ScenarioRunData[]): string | null {
  for (const run of scenarioRuns) {
    const note = run.metadata?.note?.trim();
    if (note) return note;
  }
  return null;
}

/** The window a run outside the current one needs, in days. */
export function widenedWindowDays(lastRunTimestamp: number, now: number): 30 | 90 | 365 {
  const daysAgo = Math.ceil((now - lastRunTimestamp) / 86_400_000);
  if (daysAgo <= 30) return 30;
  if (daysAgo <= 90) return 90;
  return 365;
}
