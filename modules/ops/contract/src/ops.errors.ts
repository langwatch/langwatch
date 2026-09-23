import { HandledError } from "@langwatch/handled-error";

import type { OpsOperatorPermission } from "./ops.responses.ts";

/**
 * An operator capability a process does not run, refused by name rather than
 * crashing on an absent collaborator. `fault: "platform"` because nothing the
 * customer sent caused it.
 */
export class OpsCapabilityUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `${capability} is not available on this deployment`, {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "OpsCapabilityUnavailableError";
  }
}

/** The checkup over REST is for self-hosted installs; LangWatch Cloud answers that it has none. */
export class CheckupNotSelfHostedError extends HandledError {
  declare readonly code: "checkup_not_self_hosted";

  constructor() {
    super("checkup_not_self_hosted", "The checkup is for self-hosted installs", {
      httpStatus: 404,
      fault: "customer",
    });
    this.name = "CheckupNotSelfHostedError";
  }
}

export class ReplayAlreadyRunningError extends HandledError {
  declare readonly code: "replay_already_running";

  constructor() {
    super("replay_already_running", "A replay is already running", {
      httpStatus: 409,
      fault: "customer",
    });
    this.name = "ReplayAlreadyRunningError";
  }
}

export class ReplayStartFailedError extends HandledError {
  declare readonly code: "replay_start_failed";

  constructor(cause: unknown) {
    super("replay_start_failed", "Replay could not be started", {
      httpStatus: 409,
      fault: "platform",
    });
    this.cause = cause;
    this.name = "ReplayStartFailedError";
  }
}

/**
 * Unreachable behind an authenticated procedure, kept anyway: a guard whose
 * strictest branch is the one a missing session bypasses is fail-open in
 * shape, and this stands in front of irreversible members work.
 */
export class OpsOperatorSessionRequiredError extends HandledError {
  declare readonly code: "ops_operator_session_required";

  constructor() {
    super("ops_operator_session_required", "This action needs a signed-in session.", {
      httpStatus: 403,
      fault: "customer",
    });
    this.name = "OpsOperatorSessionRequiredError";
  }
}

/**
 * The operator scope falls back to the impersonator's own grant, so
 * `ops:manage` is inherited by an impersonation session — the wrong posture
 * for irreversible surgery, since the audit trail would name the impersonated account.
 */
export class OpsImpersonatedOperatorRefusedError extends HandledError {
  declare readonly code: "ops_impersonated_operator_refused";

  constructor() {
    super(
      "ops_impersonated_operator_refused",
      "This action cannot be run from an impersonated session. Sign in directly to continue.",
      { httpStatus: 403, fault: "customer" },
    );
    this.name = "OpsImpersonatedOperatorRefusedError";
  }
}

/**
 * The damage these writes do is silent — deleting a blob completes the job
 * that referenced it without its handler running — so the confirmation makes
 * the act deliberate. The ops UI dialog is not this guard: procedures are callable directly.
 */
export class OpsConfirmationRequiredError extends HandledError {
  declare readonly code: "ops_confirmation_required";

  constructor() {
    super("ops_confirmation_required", "This action needs to be confirmed before it can run", {
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "OpsConfirmationRequiredError";
  }
}

/**
 * Reads are deliberately permissive — the catalogue surfaces orphan rows so
 * they can be deleted — but a write to an unregistered key would store a
 * value nothing ever reads.
 */
export class OpsUnknownFeatureFlagError extends HandledError {
  declare readonly code: "ops_feature_flag_unknown";

  constructor(key: string) {
    super("ops_feature_flag_unknown", `Unknown feature flag key: ${key}`, {
      httpStatus: 400,
      fault: "customer",
      meta: { key },
    });
    this.name = "OpsUnknownFeatureFlagError";
  }
}

/**
 * The whole platform tier is decided by the operator allow-list, not by an
 * RBAC grain an id in the input could be checked at — so this refusal is the
 * module's own, not a scope decision the door could have made.
 */
export class OpsOperatorRequiredError extends HandledError {
  declare readonly code: "permission_denied";

  constructor(permission: OpsOperatorPermission) {
    super("permission_denied", "This is an operator-only surface.", {
      httpStatus: 403,
      fault: "customer",
      meta: { permission },
    });
    this.name = "OpsOperatorRequiredError";
  }
}

/** No operator secret was presented, or the presented one did not match. */
export class OpsOperatorSecretRequiredError extends HandledError {
  declare readonly code: "unauthorized";

  constructor() {
    super("unauthorized", "Unauthorized", { httpStatus: 401, fault: "customer" });
    this.name = "OpsOperatorSecretRequiredError";
  }
}

/** Intake allows ten reports an hour per caller; the eleventh waits. */
export class BugReportRateLimitedError extends HandledError {
  constructor() {
    super("agent_report_rate_limited", "Too many reports, try again later", {
      httpStatus: 429,
      fault: "customer",
    });
  }
}
