import type { EvaluationSlugLookup, EvaluationSlugMatch } from "@langwatch/evaluation-contract";
import type { ExperimentApi } from "@langwatch/experiment-contract";

import type {
  EvaluationExperimentDirectory,
  EvaluationExperimentRunWriter,
} from "./evaluation-batch-log.service.ts";

type ExperimentSlice = Pick<
  ExperimentApi,
  | "findBySlug"
  | "findOrCreateForRun"
  | "startExperimentRun"
  | "recordTargetResult"
  | "recordEvaluatorResult"
  | "completeExperimentRun"
>;

/** The experiment an SDK batch or dataset evaluation is written into, and its run history. */
export class EvaluationExperimentRunService
  implements EvaluationExperimentDirectory, EvaluationExperimentRunWriter
{
  private constructor(private readonly experiments: ExperimentSlice) {}

  static create(experiments: ExperimentSlice): EvaluationExperimentRunService {
    return new EvaluationExperimentRunService(experiments);
  }

  findOrCreate(
    input: Parameters<EvaluationExperimentDirectory["findOrCreate"]>[0],
  ): Promise<EvaluationSlugMatch> {
    return this.experiments.findOrCreateForRun(input);
  }

  findBySlug(input: EvaluationSlugLookup): Promise<EvaluationSlugMatch | null> {
    return this.experiments.findBySlug(input);
  }

  startRun(input: Parameters<EvaluationExperimentRunWriter["startRun"]>[0]): Promise<void> {
    return this.experiments.startExperimentRun(input);
  }

  recordTargetResult(
    input: Parameters<EvaluationExperimentRunWriter["recordTargetResult"]>[0],
  ): Promise<void> {
    return this.experiments.recordTargetResult(input);
  }

  recordEvaluatorResult(
    input: Parameters<EvaluationExperimentRunWriter["recordEvaluatorResult"]>[0],
  ): Promise<void> {
    return this.experiments.recordEvaluatorResult(input);
  }

  completeRun(input: Parameters<EvaluationExperimentRunWriter["completeRun"]>[0]): Promise<void> {
    return this.experiments.completeExperimentRun(input);
  }
}
