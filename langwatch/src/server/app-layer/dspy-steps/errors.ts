import { NotFoundError } from "@langwatch/handled-error";

export class DspyStepNotFoundError extends NotFoundError {
  declare readonly code: "dspy_step_not_found";

  constructor(
    stepId: string,
    options: { reasons?: readonly Error[] } = {},
  ) {
    super("dspy_step_not_found", "DSPy step", stepId, {
      meta: { stepId },
      ...options,
    });
    this.name = "DspyStepNotFoundError";
  }
}
