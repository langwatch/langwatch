import { ValidationError } from "@langwatch/handled-error";

type DashboardValidationErrorSource = Readonly<{
  message: string;
  flatten(): {
    formErrors: string[];
    fieldErrors: Record<string, string[] | undefined> | string;
  };
}>;

export class DashboardNotFoundError extends Error {
  constructor() {
    super("Dashboard not found");
    this.name = "DashboardNotFoundError";
  }
}

export class DashboardReorderError extends Error {
  constructor(public readonly missingIds: string[]) {
    super(`Dashboards not found: ${missingIds.join(", ")}`);
    this.name = "DashboardReorderError";
  }
}

export class SavedViewNotFoundError extends Error {
  constructor() {
    super("Saved view not found");
    this.name = "SavedViewNotFoundError";
  }
}

export class SavedViewReorderError extends Error {
  constructor(public readonly missingIds: string[]) {
    super(`Saved views not found: ${missingIds.join(", ")}`);
    this.name = "SavedViewReorderError";
  }
}

export class GraphNotFoundError extends Error {
  constructor() {
    super("Graph not found");
    this.name = "GraphNotFoundError";
  }
}

export class SavedWorkbenchChartNotFoundError extends Error {
  constructor() {
    super("Saved chart not found");
    this.name = "SavedWorkbenchChartNotFoundError";
  }
}

export class SavedWorkbenchChartDashboardNotFoundError extends Error {
  constructor() {
    super("Dashboard not found");
    this.name = "SavedWorkbenchChartDashboardNotFoundError";
  }
}

export class SavedWorkbenchChartAlreadyExistsError extends Error {
  constructor() {
    super("A saved chart with this id already exists");
    this.name = "SavedWorkbenchChartAlreadyExistsError";
  }
}

export class SavedWorkbenchChartDefinitionUpdateProtectionsRequiredError extends Error {
  constructor() {
    super("Saved workbench chart definition updates require caller protections");
    this.name = "SavedWorkbenchChartDefinitionUpdateProtectionsRequiredError";
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

export class SavedWorkbenchChartDefinitionInvalidError extends Error {
  constructor(public readonly chartId: string) {
    super("Saved workbench chart definition is invalid");
    this.name = "SavedWorkbenchChartDefinitionInvalidError";
  }
}
