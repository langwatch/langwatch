import type { EvaluationRunData, UpsertEvaluationRunCommand } from "@langwatch/evaluation-contract";

import type { EvaluationRunProofLookup } from "./evaluation.repository.ts";

/** Run writes/reads for evaluation_processing; narrower than EvaluationService by design. */
export abstract class EvaluationRunProjectionRepository {
  abstract upsertRun(input: UpsertEvaluationRunCommand): Promise<void>;

  abstract upsertRuns(input: UpsertEvaluationRunCommand[]): Promise<void>;

  abstract findRunByEvaluationId(
    input: EvaluationRunProofLookup,
  ): Promise<EvaluationRunData | null>;
}
