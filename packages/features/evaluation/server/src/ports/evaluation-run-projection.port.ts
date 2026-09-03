import type {
  EvaluationRunData,
  EvaluationRunLookup,
  UpsertEvaluationRunCommand,
} from "@langwatch/evaluation-contract";

/**
 * The three run writes and reads the `evaluation_processing` fold performs.
 *
 * Narrower than `EvaluationService` on purpose, and the narrowing is what a
 * background process needs: the full capability additionally demands an
 * evaluator executor, an inputs-resolution port, a monitor-performance
 * repository and the whole Workflow service, none of which a fold that stores
 * a run row ever reaches. `EvaluationService` satisfies this port
 * structurally, so the application composition passes exactly what it passed
 * before, while a worker can compose {@link EvaluationRunProjectionService}
 * over the ClickHouse repository alone.
 */
export abstract class EvaluationRunProjectionPort {
  abstract upsertRun(input: UpsertEvaluationRunCommand): Promise<void>;

  abstract upsertRuns(input: UpsertEvaluationRunCommand[]): Promise<void>;

  abstract tryGetRunByEvaluationId(input: EvaluationRunLookup): Promise<EvaluationRunData | null>;
}
