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

/**
 * A monitor's `parameters` are only read when its evaluator has no settings of
 * its own: the evaluator's settings win at run time (langwatch#6397). Storing
 * parameters that disagree with them saved cleanly and read back like the live
 * configuration while never running, so they are refused instead.
 */
export class MonitorParametersUnusedError extends HandledError {
  declare readonly code: "monitor_parameters_unused";

  constructor(public readonly evaluatorId: string) {
    super(
      "monitor_parameters_unused",
      "This monitor runs with its evaluator's settings, so these parameters would never be used. " +
        "Change the evaluator's settings instead, or leave parameters out.",
      {
        meta: { field: "parameters", evaluatorId },
        httpStatus: 422,
        fault: "customer",
        ...remediation("monitor_parameters_unused"),
      },
    );
    this.name = "MonitorParametersUnusedError";
  }
}
