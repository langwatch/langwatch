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
