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
 * Raised when a workbench operation is asked to act on an experiment that is
 * not an evaluations workbench (a DSPy run, a legacy batch evaluation).
 *
 * The caller can act: the id or slug it sent names a different kind of
 * experiment, so it has to send another one. The REST workbench endpoints
 * serialise only a `HandledError`, so a plain `Error` here answered a
 * type mismatch with 500 and a trace id instead of the documented 400.
 *
 * `mapExperimentError` on the tRPC router still turns it into BAD_REQUEST,
 * so the tRPC answer does not change.
 */
export class ExperimentTypeMismatchError extends HandledError {
  declare readonly code: "experiment_type_mismatch";

  constructor() {
    super(
      "experiment_type_mismatch",
      "This experiment is not an evaluation workbench",
      { httpStatus: 400, fault: "customer" },
    );
    this.name = "ExperimentTypeMismatchError";
  }
}

/**
 * Raised when a workbench save names a version that is no longer the stored
 * one: someone else (a person in another tab, or the agent) already saved on
 * top of the state this writer read. The write is refused BEFORE anything is
 * written, so the two edits never half-merge.
 *
 * `currentVersion` rides in `meta` because reloading is the whole remedy and a
 * client that already holds the newer state can act on the number without a
 * second round trip.
 */
export class StaleWorkbenchStateError extends HandledError {
  declare readonly code: "experiment_stale_workbench_state";

  constructor({ currentVersion }: { currentVersion: number }) {
    super(
      "experiment_stale_workbench_state",
      "This evaluation changed since you loaded it",
      { httpStatus: 409, fault: "customer", meta: { currentVersion } },
    );
    this.name = "StaleWorkbenchStateError";
  }
}

/**
 * Raised when a workbench save points at a prompt, agent, evaluator, workflow
 * or dataset that this project does not have. The reference is usually a row
 * that was deleted while the workbench held it, so the caller can act: remove
 * the target, or point it at something that exists.
 *
 * `refType` and `refId` ride in `meta` so a UI can highlight the offending
 * target rather than describing it in prose.
 */
export class WorkbenchMissingReferenceError extends HandledError {
  declare readonly code: "experiment_workbench_missing_reference";

  constructor({ refType, refId }: { refType: string; refId: string }) {
    super(
      "experiment_workbench_missing_reference",
      "This evaluation points at something that no longer exists",
      { httpStatus: 400, fault: "customer", meta: { refType, refId } },
    );
    this.name = "WorkbenchMissingReferenceError";
  }
}

/**
 * Raised when a workbench save carries a state that does not match the
 * persisted schema. Unlike `InvalidExperimentConfigurationError` (a stored
 * blob nobody typed), this one is the incoming payload, so it is the caller's
 * to fix and `fault` stays `customer`.
 *
 * `issues` is a short summary of the zod issues (path + message), which is
 * what an agent caller needs to correct its own payload and retry.
 */
export class InvalidWorkbenchStateError extends HandledError {
  declare readonly code: "experiment_invalid_workbench_state";

  constructor({
    issues,
  }: {
    issues: readonly { path: string; message: string }[];
  }) {
    super(
      "experiment_invalid_workbench_state",
      "This evaluation's setup could not be saved",
      { httpStatus: 400, fault: "customer", meta: { issues } },
    );
    this.name = "InvalidWorkbenchStateError";
  }
}

/**
 * Raised when a restore or a version read names a version number this
 * experiment never had. Distinct from `experiment_not_found`: the experiment
 * is there, and the caller only has to pick another entry from its list.
 */
export class ExperimentVersionNotFoundError extends NotFoundError {
  declare readonly code: "experiment_version_not_found";

  constructor({
    experimentId,
    version,
  }: {
    experimentId: string;
    version: number;
  }) {
    super(
      "experiment_version_not_found",
      "Experiment version",
      String(version),
      { meta: { experimentId, version } },
    );
    this.name = "ExperimentVersionNotFoundError";
  }
}
