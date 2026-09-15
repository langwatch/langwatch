import { HandledError } from "@langwatch/handled-error";

// Coded because the cause is known and the reader can act on it: nothing
// was mapped, so nothing was read. A generic message would not name which
// evaluator or field is missing in a workbench with multiple evaluators.
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
