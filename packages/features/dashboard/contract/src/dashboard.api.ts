import { featureApi } from "@langwatch/runtime-composition";
/** Callable dashboard operations shared by process peers after composition. */
export interface DashboardApi {
  getAll(...args: never[]): unknown;
  getById(...args: never[]): unknown;
  create(...args: never[]): unknown;
  rename(...args: never[]): unknown;
  delete(...args: never[]): unknown;
  reorder(...args: never[]): unknown;
  getOrCreateFirst(...args: never[]): unknown;
  listGraphs(...args: never[]): unknown;
  getGraph(...args: never[]): unknown;
  createGraph(...args: never[]): unknown;
  updateGraph(...args: never[]): unknown;
  deleteGraph(...args: never[]): unknown;
  updateGraphLayout(...args: never[]): unknown;
  batchUpdateGraphLayouts(...args: never[]): unknown;
  listSavedWorkbenchCharts(...args: never[]): unknown;
  getSavedWorkbenchChart(...args: never[]): unknown;
  createSavedWorkbenchChart(...args: never[]): unknown;
  updateSavedWorkbenchChart(...args: never[]): unknown;
  deleteSavedWorkbenchChart(...args: never[]): unknown;
  placeSavedWorkbenchChart(...args: never[]): unknown;
  unplaceSavedWorkbenchChart(...args: never[]): unknown;
  runSavedWorkbenchChart(...args: never[]): unknown;
  getAlertsForGraphs(...args: never[]): unknown;
  tryGetAlertForGraph(...args: never[]): unknown;
}

export const DashboardApi = featureApi<DashboardApi>("dashboard");
