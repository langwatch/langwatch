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

export class SavedWorkbenchChartDefinitionInvalidError extends Error {
  constructor(public readonly chartId: string) {
    super("Saved workbench chart definition is invalid");
    this.name = "SavedWorkbenchChartDefinitionInvalidError";
  }
}
