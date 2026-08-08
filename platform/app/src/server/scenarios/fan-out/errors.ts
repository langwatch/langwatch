/**
 * Handled errors for the fan-out domain (ADR-045).
 *
 * Each of these names a failure the caller can act on, so it carries a stable
 * `code` the UI keys its copy off. Anything we cannot name stays a plain
 * `Error` and degrades to the generic unknown state with a trace id.
 */
import {
  HandledError,
  type HandledErrorOptions,
} from "@langwatch/handled-error";

/** Thrown when the batch does not exist in the project it was asked for. */
export class FanOutBatchNotFoundError extends HandledError {
  declare readonly code: "fan_out_batch_not_found";

  constructor(options: HandledErrorOptions = {}) {
    super("fan_out_batch_not_found", "Fan-out batch not found", {
      httpStatus: 404,
      ...options,
    });
    this.name = "FanOutBatchNotFoundError";
  }
}

/**
 * Thrown when a review decision names a variant that is not part of the batch.
 *
 * The whole decision set is rejected rather than partially applied: a reviewer
 * who sent six decisions and got four applied has no way to tell which two the
 * server dropped.
 */
export class FanOutVariantNotInBatchError extends HandledError {
  declare readonly code: "fan_out_variant_not_in_batch";

  constructor(options: HandledErrorOptions = {}) {
    super(
      "fan_out_variant_not_in_batch",
      "Some of those scenarios are no longer part of this batch",
      { httpStatus: 422, ...options },
    );
    this.name = "FanOutVariantNotInBatchError";
  }
}

/** Thrown when a batch is dispatched with nothing approved to run. */
export class FanOutNoApprovedVariantsError extends HandledError {
  declare readonly code: "fan_out_no_approved_variants";

  constructor(options: HandledErrorOptions = {}) {
    super(
      "fan_out_no_approved_variants",
      "Approve at least one scenario before running the batch",
      { httpStatus: 422, ...options },
    );
    this.name = "FanOutNoApprovedVariantsError";
  }
}

/** Thrown when a blast-radius report is asked for before the batch has run. */
export class FanOutBatchNotRunError extends HandledError {
  declare readonly code: "fan_out_batch_not_run";

  constructor(options: HandledErrorOptions = {}) {
    super("fan_out_batch_not_run", "This batch has not been run yet", {
      httpStatus: 409,
      ...options,
    });
    this.name = "FanOutBatchNotRunError";
  }
}

/**
 * Thrown when the stored target on a batch no longer matches its schema.
 *
 * The customer never typed this and cannot repair it, so it is ours:
 * `fault: "platform"` keeps it out of the customer-error noise.
 */
export class FanOutBatchTargetInvalidError extends HandledError {
  declare readonly code: "fan_out_batch_target_invalid";

  constructor(options: HandledErrorOptions = {}) {
    super(
      "fan_out_batch_target_invalid",
      "This batch does not have a valid target to run against",
      { httpStatus: 500, fault: "platform", ...options },
    );
    this.name = "FanOutBatchTargetInvalidError";
  }
}

/** Thrown when the scenario a fan-out is seeded from no longer exists. */
export class FanOutSeedScenarioNotFoundError extends HandledError {
  declare readonly code: "fan_out_seed_scenario_not_found";

  constructor(options: HandledErrorOptions = {}) {
    super(
      "fan_out_seed_scenario_not_found",
      "The scenario this batch is based on no longer exists",
      { httpStatus: 404, ...options },
    );
    this.name = "FanOutSeedScenarioNotFoundError";
  }
}

/**
 * Thrown when generation is still running past its deadline.
 *
 * `fault: "platform"` because a slow model call is our problem to absorb, not
 * something the customer misconfigured; retrying is genuinely the right move.
 */
export class FanOutGenerationTimedOutError extends HandledError {
  declare readonly code: "fan_out_generation_timed_out";

  constructor(options: HandledErrorOptions = {}) {
    super(
      "fan_out_generation_timed_out",
      "Generation took too long and was stopped",
      { httpStatus: 504, fault: "platform", ...options },
    );
    this.name = "FanOutGenerationTimedOutError";
  }
}

/** Thrown when generation is requested without a session. */
export class FanOutUnauthenticatedError extends HandledError {
  declare readonly code: "fan_out_unauthenticated";

  constructor(options: HandledErrorOptions = {}) {
    super(
      "fan_out_unauthenticated",
      "You must be logged in to generate adjacent scenarios",
      { httpStatus: 401, ...options },
    );
    this.name = "FanOutUnauthenticatedError";
  }
}
