/**
 * Every refusal this feature names, with the code a client renders copy from.
 *
 * Each one replaces a branch a door used to own: a `TRPCError` built by hand,
 * an `error.name === "…"` string comparison, or a plain `Error` a transport
 * had to recognise. The status each carries is the status those branches
 * already answered with.
 */
import { HandledError, remediation, ValidationError } from "@langwatch/handled-error";

type DashboardValidationErrorSource = Readonly<{
  message: string;
  flatten(): {
    formErrors: string[];
    fieldErrors: Record<string, string[] | undefined> | string;
  };
}>;

/** A dashboard the project does not have. */
export class DashboardNotFoundError extends HandledError {
  declare readonly code: "dashboard_not_found";

  constructor(projectId: string) {
    super("dashboard_not_found", "Dashboard not found", {
      httpStatus: 404,
      meta: { projectId },
    });
    this.name = "DashboardNotFoundError";
  }
}

/** A graph the project does not have. */
export class GraphNotFoundError extends HandledError {
  declare readonly code: "graph_not_found";

  constructor(projectId: string) {
    super("graph_not_found", "Graph not found", { httpStatus: 404, meta: { projectId } });
    this.name = "GraphNotFoundError";
  }
}

/**
 * A reorder naming dashboards the project does not have.
 *
 * 404 rather than 400 because that is what the tRPC surface has always
 * answered. The REST family answers 400 for the same refusal and keeps doing
 * so — that disagreement predates this contract, and reconciling it would
 * change a published status.
 */
export class DashboardReorderUnknownIdsError extends HandledError {
  declare readonly code: "dashboard_reorder_unknown_ids";

  constructor(readonly missingIds: readonly string[]) {
    super("dashboard_reorder_unknown_ids", `Dashboards not found: ${missingIds.join(", ")}`, {
      httpStatus: 404,
      meta: { ids: [...missingIds] },
    });
    this.name = "DashboardReorderUnknownIdsError";
  }
}

/** A saved view the project — or the caller — does not have. */
export class SavedViewNotFoundError extends HandledError {
  declare readonly code: "saved_view_not_found";

  constructor() {
    super("saved_view_not_found", "Saved view not found", { httpStatus: 404 });
    this.name = "SavedViewNotFoundError";
  }
}

/** A reorder naming saved views that are not there. */
export class SavedViewReorderUnknownIdsError extends HandledError {
  declare readonly code: "saved_view_reorder_unknown_ids";

  constructor(readonly missingIds: readonly string[]) {
    super("saved_view_reorder_unknown_ids", `Saved views not found: ${missingIds.join(", ")}`, {
      httpStatus: 404,
      meta: { ids: [...missingIds] },
    });
    this.name = "SavedViewReorderUnknownIdsError";
  }
}

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

/** One rule the visualization policy refused, as the workbench reports it. */
export type SavedWorkbenchChartSpecificationRefusal = Readonly<{
  rule: string;
  path: string;
  message: string;
}>;

export class SavedWorkbenchChartSpecificationRefusedError extends HandledError {
  declare readonly code: "saved_workbench_chart_specification_refused";

  constructor(errors: readonly SavedWorkbenchChartSpecificationRefusal[]) {
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

  constructor(
    readonly chartId: string,
    options: { reasons?: readonly Error[] } = {},
  ) {
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

/** Preserves the shared 422 validation envelope at the Dashboard boundary. */
export class SavedWorkbenchChartValidationError extends ValidationError {
  constructor(error: DashboardValidationErrorSource) {
    const flattened = error.flatten();
    const fieldErrors =
      typeof flattened.fieldErrors === "string"
        ? { form: [flattened.fieldErrors] }
        : flattened.fieldErrors;
    super(error.message, {
      meta: {
        fieldErrors,
        formErrors: flattened.formErrors,
      },
    });
    this.name = "SavedWorkbenchChartValidationError";
  }
}
