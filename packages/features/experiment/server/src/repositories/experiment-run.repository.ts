import type {
  ExperimentRun,
  ExperimentRunAggregate,
  ExperimentRunListInput,
  ExperimentRunLookup,
  ExperimentRunPageInput,
  ExperimentRunWithItems,
} from "@langwatch/experiment-contract";

/** The Experiment feature's historical-run read store. */
export abstract class ExperimentRunRepository {
  abstract list(input: ExperimentRunListInput): Promise<Record<string, ExperimentRun[]>>;
  abstract getAggregates(input: ExperimentRunListInput): Promise<Record<string, ExperimentRunAggregate>>;
  abstract getPage(input: ExperimentRunPageInput): Promise<{ runs: ExperimentRun[]; totalHits: number }>;
  /** Polling semantics: absence and an unavailable analytical store are null. */
  abstract tryGet(input: ExperimentRunLookup): Promise<ExperimentRunWithItems | null>;
}
