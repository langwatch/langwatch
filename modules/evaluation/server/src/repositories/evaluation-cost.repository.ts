/**
 * The cost ledger one evaluation run writes into: one row per run, keyed by the
 * run's own idempotency key so a redelivery reuses the row it already wrote.
 */

/** One billable evaluation run, as the ledger stores it. */
export type EvaluationCostRow = Readonly<{
  id: string;
  projectId: string;
  isGuardrail: boolean;
  evaluatorName: string;
  evaluatorId: string;
  traceId: string;
  amount: number;
  currency: string;
}>;

/** The row a caller reads back, which is only ever its id. */
export type EvaluationCostReference = Readonly<{ id: string }>;

/**
 * The ledger already holds this id. Not a customer-facing refusal: the caller's
 * answer is to read the row that is there, which is what the service does.
 */
export class EvaluationCostAlreadyRecordedError extends Error {
  constructor(readonly costId: string) {
    super(`Evaluation cost ${costId} is already recorded.`);
    this.name = "EvaluationCostAlreadyRecordedError";
  }
}

export interface EvaluationCostRepository {
  /** Writes one row, refusing with {@link EvaluationCostAlreadyRecordedError}. */
  create(input: EvaluationCostRow): Promise<void>;
  findById(input: { id: string; projectId: string }): Promise<EvaluationCostReference | undefined>;
}
