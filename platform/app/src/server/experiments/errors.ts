import { HandledError, NotFoundError } from "@langwatch/handled-error";

/**
 * Raised when an evaluation run cannot be served to the caller — no run state,
 * a run belonging to another project, or one whose owning experiment has been
 * archived. All three are one answer from outside: this run is not yours to
 * read. Which of them it actually was stays in the log line, because telling a
 * caller "wrong project" confirms the id exists.
 *
 * It exists so `GET /api/experiments/runs/:runId` can answer with a code. That
 * route already returns one for a FAILED run (`error` carries the failure's
 * code, or the unnamed-failure marker), but its not-found paths hand-rolled
 * `c.json({ error: "Run not found" })` — English prose in the same field an API
 * consumer branches on, and a 404 that bypasses the boundary serializer
 * entirely. One field cannot be both a code and a sentence.
 */
export class RunNotFoundError extends NotFoundError {
  declare readonly code: "run_not_found";

  constructor(runId: string, options: { reasons?: readonly Error[] } = {}) {
    super("run_not_found", "Run", runId, {
      meta: { runId },
      ...options,
    });
    this.name = "RunNotFoundError";
  }
}

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

/**
 * Raised when an experiment's stored workbench state no longer parses against
 * its schema. The customer did not author that blob and cannot repair it from
 * the API, so `fault: "platform"` keeps it out of the customer-error noise
 * while the caller still gets a code to branch on rather than a 500. The slug
 * rides in `meta` so a UI can name the experiment without the message having
 * to interpolate it.
 */
export class InvalidExperimentConfigurationError extends HandledError {
  declare readonly code: "invalid_experiment_configuration";

  constructor(slug: string) {
    super(
      "invalid_experiment_configuration",
      "This experiment's saved configuration could not be read.",
      { httpStatus: 400, fault: "platform", meta: { slug } },
    );
    this.name = "InvalidExperimentConfigurationError";
  }
}
