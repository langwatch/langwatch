import type { ResultsFilter } from "@langwatch/scenario-contract";

/**
 * How many configurations one read returns, at most. The cap applies AFTER the store has already
 * folded runs into distinct configurations, so it bounds the answer rather than the history: a plan
 * run nightly for a year with one setup costs one row, not three hundred and sixty-five.
 */
export const MAX_RUN_CONFIGURATIONS = 200;

/**
 * One configuration as the store folds it, before the plan row is joined. Every value is a string
 * because ClickHouse serialises UInt64 that way, and because the parameters are handed over as the
 * raw JSON they were stored as.
 */
export interface RawRunConfigurationRow {
  SetId: string;
  /** `<type>:<targetKey>` per target, sorted by the database. */
  TargetPairs: string[];
  /**
   * The raw overrides of each target, '' for a target with none, in the same
   * order as `TargetPairs`.
   */
  TargetParameters: string[];
  RepeatCount: string;
  SimulatorModel: string;
  JudgeModel: string;
  /**
   * The raw merged parameters of the first scenario run against a target with no overrides, or of
   * the first scenario run at all when every target carries some; '' when the run resolved none.
   */
  Parameters: string;
  /** The raw overrides of the target `Parameters` was read from, or ''. */
  FirstTargetParameters: string;
  /** "1" when any run of this configuration carried a note, never the note. */
  UsesNote: string;
  LastRunAtMs: string;
}

/**
 * Reads the configurations a project's plans already ran with. A sibling of {@link
 * ResultAtomsReadPort} rather than a method on it: the atom reads answer "what happened", this one
 * answers "what was it asked to do".
 */
export abstract class RunConfigurationsReadPort {
  /** One row per distinct configuration, newest first. */
  abstract findConfigurations(input: {
    filter: ResultsFilter;
    limit?: number;
  }): Promise<RawRunConfigurationRow[]>;
}
