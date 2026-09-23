import { HandledError } from "@langwatch/handled-error";

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
