/**
 * Why a run was refused before anything was queued.
 *
 * Both reasons are the caller's to fix - an unknown scenario, an unsatisfiable
 * parameter, a target the prefetch could not validate - so they answer at the
 * status the surface has always answered them with rather than degrading to an
 * unknown failure.
 */
import { HandledError } from "@langwatch/handled-error";

/** A run this project cannot start as asked. */
export class ScenarioRunRejectedError extends HandledError {
  declare readonly code: "scenario_run_rejected";

  constructor(message: string, options: { reasons?: readonly Error[] } = {}) {
    super("scenario_run_rejected", message, {
      httpStatus: 400,
      fault: "customer",
      ...(options.reasons ? { reasons: options.reasons } : {}),
    });
    this.name = "ScenarioRunRejectedError";
  }
}
