import type { VegaValidationError } from "@langwatch/analytics-contract/visualization/validation";
import { HandledError, remediation } from "@langwatch/handled-error";

/** Preserves the established REST and tRPC error envelopes at the Dashboard transport edge. */
export class SavedWorkbenchChartNotFoundError extends HandledError {
  declare readonly code: "saved_workbench_chart_not_found";

  constructor() {
    super("saved_workbench_chart_not_found", "Saved chart not found.", {
      httpStatus: 404,
      fault: "customer",
      ...remediation("saved_workbench_chart_not_found"),
    });
    this.name = "SavedWorkbenchChartNotFoundError";
  }
}

export class SavedWorkbenchChartAlreadyExistsError extends HandledError {
  declare readonly code: "saved_workbench_chart_already_exists";

  constructor() {
    super("saved_workbench_chart_already_exists", "A saved chart with this id already exists.", {
      httpStatus: 409,
      fault: "customer",
      ...remediation("saved_workbench_chart_already_exists"),
    });
    this.name = "SavedWorkbenchChartAlreadyExistsError";
  }
}

export class SavedWorkbenchChartDashboardNotFoundError extends HandledError {
  declare readonly code: "saved_workbench_chart_dashboard_not_found";

  constructor() {
    super("saved_workbench_chart_dashboard_not_found", "Dashboard not found.", {
      httpStatus: 404,
      fault: "customer",
      ...remediation("saved_workbench_chart_dashboard_not_found"),
    });
    this.name = "SavedWorkbenchChartDashboardNotFoundError";
  }
}

export class SavedWorkbenchChartSpecificationRefusedError extends HandledError {
  declare readonly code: "saved_workbench_chart_specification_refused";

  constructor(errors: readonly VegaValidationError[]) {
    super(
      "saved_workbench_chart_specification_refused",
      "The chart specification was refused by the visualization policy.",
      {
        httpStatus: 400,
        fault: "customer",
        meta: {
          errors: errors.map((error) => ({
            rule: error.rule,
            path: error.path,
            message: error.message,
          })),
        },
        ...remediation("saved_workbench_chart_specification_refused"),
      },
    );
    this.name = "SavedWorkbenchChartSpecificationRefusedError";
  }
}

export class SavedWorkbenchChartDefinitionInvalidError extends HandledError {
  declare readonly code: "saved_workbench_chart_definition_invalid";

  constructor(chartId: string, options: { reasons?: readonly Error[] } = {}) {
    super(
      "saved_workbench_chart_definition_invalid",
      "This saved chart's definition could not be read.",
      {
        httpStatus: 500,
        fault: "platform",
        meta: { chartId },
        ...remediation("saved_workbench_chart_definition_invalid"),
        ...options,
      },
    );
    this.name = "SavedWorkbenchChartDefinitionInvalidError";
  }
}
