import { NotFoundError } from "@langwatch/handled-error";

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
