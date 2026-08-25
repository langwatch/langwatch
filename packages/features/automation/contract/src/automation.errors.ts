export class AutomationNotFoundError extends Error {
  constructor() {
    super("Automation not found");
    this.name = "AutomationNotFoundError";
  }
}
export class TriggerNotFoundError extends Error {
  constructor() {
    super("Trigger not found");
    this.name = "TriggerNotFoundError";
  }
}
export class InvalidUnsubscribeTokenError extends Error {
  constructor() {
    super("Invalid or tampered unsubscribe token");
    this.name = "InvalidUnsubscribeTokenError";
  }
}

/** A trace automation must have a condition, otherwise it would evaluate
 * every trace in its project. Alert and report triggers are exempt. */
export class TriggerFiltersRequiredError extends HandledError {
  declare readonly code: "trigger_filters_required";

  constructor() {
    super(
      "trigger_filters_required",
      "An automation needs at least one condition. Add a filter or a query, otherwise it would fire on every single trace.",
      { meta: { field: "filters" }, httpStatus: 422 },
    );
    this.name = "TriggerFiltersRequiredError";
  }
}
import { HandledError } from "@langwatch/handled-error";
