/**
 * The evaluator behind a monitor, as this feature reads it.
 *
 * A PORT rather than the `EvaluatorApi` peer token, and only until that token
 * grows the read: a monitor may only name an evaluator its own project holds,
 * and `EvaluatorApi` publishes `getAll`, `create`, `update` and `archive` but
 * no lookup by id. The process supplies its own canonical evaluator service
 * here, so the check is the same one it always was.
 *
 * @see packages/features/evaluator/contract/src/evaluator.api.ts
 */
export abstract class MonitorEvaluatorPort {
  /** Refuses by the evaluator feature's own error when the project has none. */
  abstract getById(input: Readonly<{ id: string; projectId: string }>): Promise<unknown>;
  /** Rolls a copied evaluator back when the replicated monitor cannot be written. */
  abstract archive(input: Readonly<{ id: string; projectId: string }>): Promise<unknown>;
}
