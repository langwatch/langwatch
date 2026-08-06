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

/**
 * Raised when an experiment has no dataset to work against, either because it
 * carries none at all or because its `activeDatasetId` points at one that is
 * no longer in the list.
 *
 * Both are the same answer to a caller: there is nothing to run rows from, and
 * the fix is to pick a dataset in the workbench. It exists so the API-key
 * routes stop resolving a dataset by guessing (a positional `datasets[0]`, a
 * literal `"dataset-1"` id) and silently building state that references a
 * dataset the experiment does not have.
 */
export class ExperimentDatasetMissingError extends HandledError {
  declare readonly code: "experiment_dataset_missing";

  constructor(meta: { slug?: string; activeDatasetId?: string } = {}) {
    super(
      "experiment_dataset_missing",
      "This experiment has no dataset selected.",
      { httpStatus: 400, meta },
    );
    this.name = "ExperimentDatasetMissingError";
  }
}

/**
 * Raised when a conditional write against an experiment matched no row because
 * the experiment changed after it was read.
 *
 * The workbench state is one JSON blob that several writers own: the Workbench
 * UI autosaves the whole field over tRPC while API-key routes patch pieces of
 * it. A read-modify-write with no guard lets whichever write lands second
 * discard the other's edit in full, so the write is conditional on the
 * `updatedAt` observed at read time and this is what an unmatched condition
 * means. Retrying re-reads the current state and reapplies the change.
 */
export class ExperimentUpdateConflictError extends HandledError {
  declare readonly code: "experiment_update_conflict";

  constructor(meta: { experimentId?: string; slug?: string } = {}) {
    super(
      "experiment_update_conflict",
      "This experiment changed while the update was being prepared. Read it again and retry.",
      { httpStatus: 409, meta },
    );
    this.name = "ExperimentUpdateConflictError";
  }
}
