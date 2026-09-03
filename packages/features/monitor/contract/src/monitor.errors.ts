import { HandledError } from "@langwatch/handled-error";

export class MonitorNotFoundError extends Error {
  readonly code = "monitor_not_found" as const;

  constructor(readonly monitorId: string) {
    super(`Monitor ${monitorId} not found.`);
    this.name = "MonitorNotFoundError";
  }
}

export class MonitorEvaluatorRequiredError extends HandledError {
  declare readonly code: "monitor_evaluator_required";

  constructor() {
    super(
      "monitor_evaluator_required",
      "An evaluator is required to create an online evaluation.",
      { httpStatus: 400, fault: "customer" },
    );
    this.name = "MonitorEvaluatorRequiredError";
  }
}
