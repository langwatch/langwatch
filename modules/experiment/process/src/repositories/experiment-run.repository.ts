import type {
  ExperimentRun,
  ExperimentRunAggregate,
  ExperimentRunListInput,
  ExperimentRunLookup,
  ExperimentRunPageInput,
  ExperimentRunWorkflowVersion,
  ExperimentRunWithItems,
} from "@langwatch/experiment-contract";

/** The Experiment feature's historical-run read store. */
export abstract class ExperimentRunRepository {
  abstract findAll(input: ExperimentRunListInput): Promise<Record<string, ExperimentRun[]>>;
  abstract findAggregates(
    input: ExperimentRunListInput,
  ): Promise<Record<string, ExperimentRunAggregate>>;
  abstract listPage(
    input: ExperimentRunPageInput,
  ): Promise<{ runs: ExperimentRun[]; totalHits: number }>;
  /** Polling semantics: absence and an unavailable analytical store are null. */
  abstract findRun(input: ExperimentRunLookup): Promise<ExperimentRunWithItems | null>;
  abstract findWorkflowVersions(
    projectId: string,
    versionIds: string[],
  ): Promise<Record<string, ExperimentRunWorkflowVersion>>;
}
