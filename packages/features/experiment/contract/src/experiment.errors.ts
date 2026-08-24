import { NotFoundError } from "@langwatch/handled-error";

export class ExperimentNotFoundError extends NotFoundError {
  declare readonly code: "experiment_not_found";

  constructor(id: string, options: { reasons?: readonly Error[] } = {}) {
    super("experiment_not_found", "Experiment", id, {
      meta: { experimentId: id },
      ...options,
    });
    this.name = "ExperimentNotFoundError";
  }
}
