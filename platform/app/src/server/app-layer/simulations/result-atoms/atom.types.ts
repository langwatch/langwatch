import type { RunParameterValues } from "~/server/scenarios/parameters";
import type { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";

/** The target key a run carries when it names no platform target. */
export const UNKNOWN_TARGET_KEY = "unknown";

/**
 * Where an atom's cost came from.
 *
 * The four values exist because "no cost" means two different things on a
 * scenario run row, and a page that cannot tell them apart reports a total
 * that looks complete and is not.
 *
 * - `run`     the stored per-scenario total. The normal case.
 * - `traces`  the per-trace map on the same row, summed. The fold writes the
 *             stored total as NULL when the traces sum to zero, so this is what
 *             separates a run that was measured and cost nothing from one that
 *             was never measured.
 * - `none`    the run reached no trace at all, so it spent nothing. Known.
 * - `unknown` the run has traces but no cost was ever computed for them. This
 *             is the only value that means the number is missing, and it is the
 *             only one counted in `unknownAtoms`.
 */
export type AtomCostSource = "run" | "traces" | "none" | "unknown";

/** How an atom's status reads once categorised. */
export type AtomOutcome = "passed" | "failed" | "pending";

/**
 * One scenario, run once against one target, inside one run.
 *
 * This is the grain the Results tab aggregates: every grouping is a fold over
 * atoms and every filter is a cut of them, which is what makes one filter move
 * every number on the page.
 *
 * It maps one to one onto a deduped `simulation_runs` row, so the read grain
 * and the storage grain are the same. That is why cost needs no coarser total
 * to fall back to.
 */
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
   * The key the platform stamped (the reference id, or the reference id and a
   * hash of the target's parameter overrides), the bare `targetReferenceId`
   * of a run recorded before that stamp, `code:` and the slug of the agent
   * name a run from code reported, or {@link UNKNOWN_TARGET_KEY}.
   */
  targetKey: string;
  /**
   * The parameter overrides of the run's target alone, or null when the
   * target carried none. What tells `prod-agent · model=gpt-5-mini` from
   * `prod-agent`; the client names the agent through its own target map and
   * appends these.
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

/**
 * What is in scope. Both reads take the same filter so the overview and the
 * atom list can never disagree about what the page is showing.
 *
 * `scenarioIds` carries the resolution of a label or a test suite filter:
 * labels and test suites live in Postgres, so the caller turns them into
 * scenario ids
 * before the query runs.
 */
export interface ResultsFilter {
  projectId: string;
  startDate: number;
  /**
   * Optional upper bound, epoch ms.
   *
   * Leave it out for a live view. The period picker pins its end at mount, so
   * sending it would filter on "started before the page loaded" and a run that
   * begins while someone watches would never appear, on the one surface whose
   * job is watching runs happen. Pass it only for a snapshot, such as an
   * export, where the window must not move under the reader.
   */
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
