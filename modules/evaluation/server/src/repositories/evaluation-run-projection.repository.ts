import type {
  EvaluationRunData,
  EvaluationRunLookup,
  UpsertEvaluationRunCommand,
} from "@langwatch/evaluation-contract";

/** Run writes/reads for evaluation_processing; narrower than EvaluationService by design. */
export abstract class EvaluationRunProjectionRepository {
  abstract upsertRun(input: UpsertEvaluationRunCommand): Promise<void>;

  abstract upsertRuns(input: UpsertEvaluationRunCommand[]): Promise<void>;

  abstract findRunByEvaluationId(input: EvaluationRunLookup): Promise<EvaluationRunData | null>;
}
