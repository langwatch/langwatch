import { HandledError } from "@langwatch/handled-error";

import { remediation } from "../error-remediation";

/**
 * A monitor (online evaluation) cannot exist without an evaluator: it would
 * sit enabled but evaluate nothing, and the app's edit drawer would show an
 * empty evaluator selection. Raised when a create omits `evaluatorId` or an
 * update sets it to null. Monitors that predate evaluators keep running off
 * their stored parameters, so updates that leave `evaluatorId` untouched are
 * not gated.
 */
export class MonitorEvaluatorRequiredError extends HandledError {
  declare readonly code: "monitor_evaluator_required";

  constructor(options: { reasons?: readonly Error[] } = {}) {
    super(
      "monitor_evaluator_required",
      "An evaluator is required to create an online evaluation",
      {
        httpStatus: 400,
        fault: "customer",
        ...remediation("monitor_evaluator_required"),
        ...options,
      },
    );
    this.name = "MonitorEvaluatorRequiredError";
  }
}
