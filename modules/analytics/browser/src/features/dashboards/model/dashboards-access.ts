/**
 * Whether the Dashboards area opens for this reader. A missing grant answers
 * the same not-found as the flag being off (AC21), so the area's existence is
 * never disclosed to someone who may not see it.
 */

export const DASHBOARDS_FLAG = "release_dashboards";
export const DASHBOARDS_PERMISSION = "analytics:view";

export type DashboardsAccess = "loading" | "not-found" | "open";

export function dashboardsAccess({
  flag,
  isSettled,
  canView,
}: {
  /** The flag's answer; `undefined` until it has arrived. */
  flag: boolean | undefined;
  isSettled: boolean;
  canView: boolean;
}): DashboardsAccess {
  if (flag === void 0) return "loading";
  if (!flag) return "not-found";
  if (!isSettled) return "loading";
  return canView ? "open" : "not-found";
}
