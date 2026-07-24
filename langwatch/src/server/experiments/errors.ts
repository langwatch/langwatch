import { NotFoundError } from "@langwatch/handled-error";

export class ExperimentNotFoundError extends NotFoundError {
  declare readonly code: "experiment_not_found";

  constructor(
    experimentId: string,
    options: { reasons?: readonly Error[] } = {},
  ) {
    super("experiment_not_found", "Experiment", experimentId, {
      meta: { experimentId },
      ...options,
    });
    this.name = "ExperimentNotFoundError";
  }
}
