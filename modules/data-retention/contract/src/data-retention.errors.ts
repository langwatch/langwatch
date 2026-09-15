import { HandledError } from "@langwatch/handled-error";
import type { RetroactiveMutationProgress } from "./data-retention.ts";

/** The scope a retention override was aimed at is not there to hang one on. */
export class ScopeTargetNotFoundError extends HandledError {
  declare readonly code: "data_retention_scope_target_not_found";

  constructor(message = "That retention scope no longer exists.") {
    super("data_retention_scope_target_not_found", message, { httpStatus: 404 });
    this.name = "ScopeTargetNotFoundError";
  }
}

/**
 * An earlier retroactive update is still rewriting rows. `blocked` is the list
 * the settings page renders beside the refusal, so the reader can wait for or
 * stop the named updates.
 */
export class RetroactiveMutationInProgressError extends HandledError {
  declare readonly code: "data_retention_mutation_in_progress";

  constructor(readonly blocked: RetroactiveMutationProgress[]) {
    const summary = blocked
      .map((mutation) => `${mutation.table} (${mutation.mutationId})`)
      .join(", ");
    super(
      "data_retention_mutation_in_progress",
      `Retroactive update already in progress for: ${summary}. ` +
        "Wait for completion or kill the listed mutation(s) before starting another.",
      { httpStatus: 409, retryable: true },
    );
    this.name = "RetroactiveMutationInProgressError";
  }
}

/** Per-scope retention is a paid capability; a free organization has none. */
export class RetentionNotOnPlanError extends HandledError {
  declare readonly code: "data_retention_not_on_plan";

  constructor() {
    super(
      "data_retention_not_on_plan",
      "Configuring data retention is a paid-plan feature.",
      { httpStatus: 403 },
    );
    this.name = "RetentionNotOnPlanError";
  }
}

/** The length asked for is under the floor this plan sells. */
export class RetentionLengthBelowPlanMinimumError extends HandledError {
  declare readonly code: "data_retention_length_below_plan_minimum";

  constructor(readonly minimumDays: number) {
    super(
      "data_retention_length_below_plan_minimum",
      `Retention must be at least ${minimumDays} days on this plan.`,
      { httpStatus: 403, meta: { minimumDays } },
    );
    this.name = "RetentionLengthBelowPlanMinimumError";
  }
}

/** The length asked for is not one of the lengths this plan offers. */
export class RetentionLengthNotOnPlanError extends HandledError {
  declare readonly code: "data_retention_length_not_on_plan";

  constructor() {
    super(
      "data_retention_length_not_on_plan",
      "That retention length is not available on this plan.",
      { httpStatus: 403 },
    );
    this.name = "RetentionLengthNotOnPlanError";
  }
}

/** The caller may not write a retention override at the tier they aimed at. */
export class ScopeWriteForbiddenError extends HandledError {
  declare readonly code: "data_retention_scope_write_forbidden";

  constructor(
    readonly scopeType: string,
    readonly requiredPermission: string,
  ) {
    super(
      "data_retention_scope_write_forbidden",
      `Changing data retention at this ${scopeType.toLowerCase()} needs ${requiredPermission}.`,
      { httpStatus: 403, meta: { scopeType, requiredPermission } },
    );
    this.name = "ScopeWriteForbiddenError";
  }
}

/** Keeping data forever is a platform capability, not a customer tier. */
export class RetentionDisableForbiddenError extends HandledError {
  declare readonly code: "data_retention_disable_forbidden";

  constructor() {
    super(
      "data_retention_disable_forbidden",
      "Only platform administrators can keep data indefinitely.",
      { httpStatus: 403 },
    );
    this.name = "RetentionDisableForbiddenError";
  }
}

export class DataRetentionBackendUnavailableError extends Error {
  readonly name = "DataRetentionBackendUnavailableError" as const;

  constructor() {
    super("ClickHouse not available");
  }
}
