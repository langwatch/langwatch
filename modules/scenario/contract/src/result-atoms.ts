/** Result atoms: one scenario run against one target; shared vocabulary for
 * browser and read side (types only).
 */

import type { ScenarioRunStatus } from "./scenario-run.ts";
import type { RunParameterValues } from "./scenario.parameters.ts";
import type { ScenarioEvaluationStatus } from "./schemas/event-schemas.ts";

/** The target key a run carries when it names no platform target. */
export const UNKNOWN_TARGET_KEY = "unknown";

/** Cost source: run (stored total), traces (per-trace sum), none (no trace),
 * or unknown (no cost computed).
 */
export type AtomCostSource = "run" | "traces" | "none" | "unknown";

/**
 * How an atom's status reads once categorised: read off the run's status,
 * which already holds the evaluator gate — a failed required evaluator
 * already turned it failed, so an atom never reads passed past that.
 */
export type AtomOutcome = "passed" | "failed" | "pending";

/**
 * One evaluator result on an atom, as much of it as a results table needs:
 * what ran, whether it counted, and what it said. The details and the
 * resolved inputs stay on the run itself.
 */
export interface AtomEvaluation {
  evaluatorId: string;
  name: string;
  status: ScenarioEvaluationStatus;
  required: boolean;
  passed: boolean | null;
  score: number | null;
  label: string | null;
}

/** Atom grain: one scenario run against one target, maps 1:1 to deduped
 * simulation_runs rows.
 */

/**
 * The most atoms one page may carry. The read clamps to it, and the Results
 * tab's own request schema refuses a larger page rather than silently
 * returning fewer rows than it asked for.
 */
export const MAX_ATOM_PAGE = 500;

/** Most bars a sparkline draws. See the group trend contract. */
export const MAX_TREND_POINTS = 14;

export interface ResultAtom {
  /** `SimulationSuite.slug`, or the raw scenario set id for a code-pushed set. */
  planSlug: string;
  /** The run the atom belongs to: one batch. */
  runId: string;
  /** The atom's own identity: one scenario run. */
  executionId: string;
  /**
   * The number of this run inside its plan, oldest first, counted WITHIN the
   * queried window. It is not a lifetime run number: widening the period
   * renumbers the runs, the same way the period-scoped page renders them.
   */
  runOrdinal: number;
  /** When the run started, epoch ms. */
  runAt: number;
  /**
   * What started the run. `app` when the platform stamped a target on it (a
   * one-off run or a suite run), `code` when it arrived from an SDK or CI push
   * with no platform target.
   */
  trigger: "app" | "code";
  /** The note of the run, or null. Never part of a plan's configuration. */
  note: string | null;
  scenarioId: string;
  /**
   * The key the scenario folds under: its id for a run started on the
   * platform, its set and its name for a run pushed from code, whose id the
   * SDK made up for that one run.
   */
  scenarioKey: string;
  /** The name the run carries, or null when it carries none. */
  scenarioName: string | null;
  /**
   * The key the platform stamped (reference id, or with a parameter-override
   * hash), the bare `targetReferenceId` from before that stamp, `code:` plus
   * the agent slug for a code-reported run, or {@link UNKNOWN_TARGET_KEY}.
   */
  targetKey: string;
  /**
   * The parameter overrides of the run's target alone, or null when it
   * carried none — what tells `prod-agent · model=gpt-5-mini` from
   * `prod-agent`; the client appends these to its own target map.
   */
  targetParameters: RunParameterValues | null;
  /**
   * The agent name the code that pushed the run reported, or null when it
   * reported none. A run started on the platform is named by its reference id
   * instead, so this stays null there.
   */
  targetName: string | null;
  status: ScenarioRunStatus;
  outcome: AtomOutcome;
  /** One entry per evaluator that ran on the scenario; empty when none did. */
  evaluations: AtomEvaluation[];
  durationMs: number | null;
  /** Null only when {@link costSource} is `unknown`. */
  costUsd: number | null;
  costSource: AtomCostSource;
}

/** Cost of a set of atoms, stating its own coverage. */
export interface AtomCost {
  /** Sums only the atoms whose cost is known. */
  totalUsd: number;
  knownAtoms: number;
  /** Atoms whose cost was never measured. `knownAtoms + unknownAtoms` is the atom count. */
  unknownAtoms: number;
}

/** One bar of a group's sparkline. */
export interface TrendPoint {
  key: string;
  /** 0..100, or null when nothing in the point settled. */
  passRate: number | null;
}

/** One bucket of the pass-rate-over-time chart. */
export interface SeriesBucket {
  label: string;
  passRate: number | null;
  isEmpty: boolean;
}

export type ResultsGroupBy = "plan" | "scenario" | "target" | "none";

/** One scenario that ran from code, as the scenario filter lists it. */
export interface CodeScenario {
  /** The key its runs fold under, and what the scenario filter takes. */
  key: string;
  name: string;
}

/**
 * One target the window's runs name that the stored agent and prompt lists
 * cannot: a target a run from code named, or a stored target run with
 * parameter overrides. What the target filter lists beside the stored lists.
 */
export interface RunTarget {
  /** The key its runs fold under, and what the target filter takes. */
  key: string;
  /**
   * The stored agent or prompt the target points at, for a platform target
   * run with overrides. Null for a target a run from code named, which has
   * no row to point at. The client names the target through this id.
   */
  referenceId: string | null;
  /** The parameter overrides of the target, or null when it carried none. */
  parameters: RunParameterValues | null;
  /**
   * The agent name the run reported, for a target named from code. A
   * platform target reports none and reads as its key here; the client
   * names it from `referenceId` and `parameters`.
   */
  name: string;
}

export interface ResultGroup {
  /** planSlug, scenarioId, targetKey or executionId, following `groupBy`. */
  key: string;
  title: string;
  subtitle: string | null;
  /** 0..100, or null when nothing settled. Never coerced to zero. */
  passRate: number | null;
  runCount: number;
  scenarioCount: number;
  lastRunAt: number | null;
  /** Target keys used by the listed runs, sorted. Named by the client. */
  targetKeys: string[];
  /**
   * The parameter overrides of the group's target, for a target grouping
   * whose target carried any; null otherwise. What lets the client read the
   * row as `prod-agent · model=gpt-5-mini`.
   */
  targetParameters: RunParameterValues | null;
  /** Oldest first, at most 14 points, most recent kept when there are more. */
  trend: TrendPoint[];
  cost: AtomCost;
}

export interface ResultTotals {
  /** Atoms in scope. */
  executions: number;
  /** Distinct runs in scope. */
  runCount: number;
  passRate: number | null;
  /** Distinct scenarios with at least one failed atom. */
  failingScenarios: number;
  cost: AtomCost;
  /** Pass rate over time, oldest first. */
  series: SeriesBucket[];
}

export interface ResultsOverview {
  totals: ResultTotals;
  groups: ResultGroup[];
}

/** Scope filter for results; shared between overview and atom list to ensure
 * consistent page views.
 */
export interface ResultsFilter {
  projectId: string;
  startDate: number;
  /** Optional end time (epoch ms); omit for live view, set for snapshots. */
  endDate?: number;
  scenarioIds?: string[];
  /**
   * Labels to keep. Resolved to scenario ids before the query runs, because
   * labels live in Postgres and the run row carries none.
   */
  labels?: string[];
  /** Suites to keep, by test suite id. Resolved to scenario ids the same way. */
  testSuiteIds?: string[];
  scenarioSetIds?: string[];
  targetKeys?: string[];
  /** `passed` and `failed` fold several statuses each, see categorizeRunStatus. */
  outcome?: AtomOutcome;
}
