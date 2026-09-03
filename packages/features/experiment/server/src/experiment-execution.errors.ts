import { HandledError } from "@langwatch/handled-error";

/**
 * An evaluator was asked to grade a row that resolved no input at all.
 *
 * Coded rather than left as a bare string because the cause is known and the
 * reader can act on it: nothing is mapped, so nothing was read. Without a code
 * the cell fell back to the generic "The evaluator failed to run. Check its
 * configuration, then run again.", which names neither the evaluator nor the
 * field that is missing, and a workbench usually has several evaluators on the
 * same row.
 */
export class EvaluatorNoInputsResolvedError extends HandledError {
  declare readonly code: "evaluator_no_inputs_resolved";

  constructor(evaluatorName: string) {
    super("evaluator_no_inputs_resolved", `${evaluatorName} received no input for this row.`, {
      httpStatus: 400,
      fault: "customer",
      // Named consumer: the results cell, which draws the evaluator's name so
      // the reader knows which of the row's evaluators to go and map.
      meta: { evaluatorName },
    });
    this.name = "EvaluatorNoInputsResolvedError";
  }
}
