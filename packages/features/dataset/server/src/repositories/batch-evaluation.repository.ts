import type {
  BatchEvaluationRecord,
  BatchEvaluationSummary,
} from "@langwatch/dataset-contract";

/**
 * The batch-evaluation rows an experiment's runs are summarised by. They sit
 * beside the datasets they ran against, which is why this feature owns them.
 */
export interface BatchEvaluationRepository {
  /** One row per experiment and dataset: how many ran, total cost, mean score. */
  summariseByExperiment(input: { projectId: string }): Promise<BatchEvaluationSummary[]>;
  /** Every record of one experiment, with the dataset each ran against. */
  findAllByExperiment(input: {
    projectId: string;
    experimentId: string;
  }): Promise<BatchEvaluationRecord[]>;
}
