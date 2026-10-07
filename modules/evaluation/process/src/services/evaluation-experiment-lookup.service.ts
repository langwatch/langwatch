import type { EvaluationSlugLookup, EvaluationSlugMatch } from "@langwatch/evaluation-contract";
import type { ExperimentApi } from "@langwatch/experiment-contract";

/** The experiment a dataset evaluation names by slug. */
export interface EvaluationExperimentDirectory {
  findBySlug(input: EvaluationSlugLookup): Promise<EvaluationSlugMatch | null>;
}

/** Answers the dataset evaluation door's experiment slug from experiment's own directory. */
export class EvaluationExperimentLookupService implements EvaluationExperimentDirectory {
  private constructor(private readonly experiments: Pick<ExperimentApi, "findBySlug">) {}

  static create(experiments: Pick<ExperimentApi, "findBySlug">): EvaluationExperimentLookupService {
    return new EvaluationExperimentLookupService(experiments);
  }

  findBySlug(input: EvaluationSlugLookup): Promise<EvaluationSlugMatch | null> {
    return this.experiments.findBySlug(input);
  }
}
