import { DashboardReadOnlyError, isCodeDefinedDashboardId } from "@langwatch/dashboard-contract";

/**
 * Refuses any write aimed at a code-defined board such as the Agent Flight
 * Deck (spec: dashboards-v1.feature, AC8). It has no row, so without this a
 * write would answer "not found" instead of saying why.
 */
export function refuseCodeDefinedDashboard(dashboardId: string): void {
  if (isCodeDefinedDashboardId(dashboardId)) throw new DashboardReadOnlyError(dashboardId);
}
