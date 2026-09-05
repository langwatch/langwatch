import type {
  ResultsFilter,
  ResultsGroupBy,
  ScenarioRunStatus,
} from "@langwatch/scenario-contract";

/** Hard ceiling on one page of atoms, whatever the caller asks for. */
export const MAX_ATOM_PAGE = 500;

/** Most bars a sparkline draws. See the group trend contract. */
export const MAX_TREND_POINTS = 14;

/** How many scenarios that ran from code the filter lists at most. */
export const MAX_CODE_SCENARIOS = 500;

/** How many targets the window names beyond the stored lists, at most. */
export const MAX_RUN_TARGETS = 500;

/**
 * An atom as the store returns it: everything that lives on the run row. The plan slug, the plan
 * name and the scenario name are NOT here. They live in Postgres, and joining them in the query
 * would mean a second store in the hot path for values the caller already holds.
 */
export interface RawAtomRow {
  SetId: string;
  BatchRunId: string;
  ScenarioRunId: string;
  ScenarioId: string;
  /** The key the scenario folds under. */
  ScenarioKey: string;
  /** The name the run carries, or '' when it carries none. */
  ScenarioName: string;
  /** Already mapped to the domain status: the store owns the raw spelling. */
  Status: ScenarioRunStatus;
  Outcome: string;
  RunAt: string;
  DurationMs: string;
  Note: string;
  TargetKey: string;
  /** The raw overrides of the run's target, or '' when it carried none. */
  TargetParameters: string;
  /** The agent name the run reported, or '' when it reported none. */
  TargetName: string;
  Trigger: string;
  CostUsd: string;
  CostSource: string;
  SortKey: string;
}

/** One run of one plan, with the position that gives it its number. */
export interface RunOrdinalRow {
  SetId: string;
  BatchRunId: string;
  RunAt: string;
  Ordinal: string;
}

/** One group as the store folds it, before names are attached. */
export interface RawGroupRow {
  GroupKey: string;
  /** The name the newest run of the group carries, or '' when it carries none. */
  Name: string;
  /** The agent name the newest run reported, or '' when it reported none. */
  TargetName: string;
  /** The raw overrides of the group's target, or '' when it carried none. */
  TargetParameters: string;
  Atoms: string;
  Passed: string;
  Settled: string;
  RunCount: string;
  ScenarioCount: string;
  LastRunAt: string;
  TargetKeys: string[];
  CostTotal: string;
  CostUnknown: string;
}

/** One sparkline bar, still keyed to its group. */
export interface RawTrendRow {
  GroupKey: string;
  TrendKey: string;
  RunAt: string;
  Passed: string;
  Settled: string;
}

/** One scenario that ran from code, as the filter lists it. */
export interface RawCodeScenarioRow {
  ScenarioKey: string;
  Name: string;
}

/**
 * One target the stored lists cannot name, as the filter lists it: a target
 * a run from code named, or a stored target run with parameter overrides.
 */
export interface RawRunTargetRow {
  TargetKey: string;
  /** The agent name the run reported, or '' for a platform target. */
  Name: string;
  /** The stored reference id, or '' for a target named from code. */
  ReferenceId: string;
  /** The raw overrides of the target, or '' when it carried none. */
  TargetParameters: string;
}

/** One bucket of the pass-rate-over-time chart. */
export interface RawSeriesRow {
  Bucket: string;
  Passed: string;
  Settled: string;
}

/** Project-wide counts the stat strip reads. */
export interface RawTotalsRow {
  Atoms: string;
  Passed: string;
  Settled: string;
  RunCount: string;
  FailingScenarios: string;
  CostTotal: string;
  CostUnknown: string;
}

/**
 * The atom reads that back the Results tab. Kept apart from `SimulationRepository` because it
 * answers a different question. That repository serves v1, which reads runs one batch or one set at
 * a time; this one reads the whole window flat so a filter can cut it and a grouping can fold it.
 */
export abstract class ResultAtomsReadPort {
  /** One page of atoms, newest first, keyset paginated. */
  abstract findAtoms(input: {
    filter: ResultsFilter;
    limit: number;
    cursor?: string;
  }): Promise<{ atoms: RawAtomRow[]; nextCursor?: string; hasMore: boolean }>;
  /** The number every run carries inside its plan, oldest first, over the window. */
  abstract findRunOrdinals(filter: ResultsFilter): Promise<RunOrdinalRow[]>;
  /** The stat strip counts, over every atom in scope. */
  abstract aggregateTotals(filter: ResultsFilter): Promise<RawTotalsRow | null>;
  /** One row per group, folded so volume never reaches the client. */
  abstract aggregateGroups(input: {
    filter: ResultsFilter;
    groupBy: ResultsGroupBy;
  }): Promise<RawGroupRow[]>;
  /** The scenarios that ran from code inside the window, one per key. */
  abstract findCodeScenarios(filter: ResultsFilter): Promise<RawCodeScenarioRow[]>;
  /** The targets the window names that the stored agent and prompt lists cannot. */
  abstract findRunTargets(filter: ResultsFilter): Promise<RawRunTargetRow[]>;
  /** The sparkline points of every group, trimmed to what a sparkline draws. */
  abstract aggregateTrend(input: {
    filter: ResultsFilter;
    groupBy: ResultsGroupBy;
  }): Promise<RawTrendRow[]>;
  /** Pass rate over time, in fixed buckets. */
  abstract aggregateSeries(input: {
    filter: ResultsFilter;
    bucketSeconds: number;
  }): Promise<RawSeriesRow[]>;
}
