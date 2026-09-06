/**
 * Domain-specific errors for dashboard operations.
 * These are thrown by the service layer and mapped to tRPC errors by the router.
 */

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
