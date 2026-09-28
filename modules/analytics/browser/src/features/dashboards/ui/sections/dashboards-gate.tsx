/** Every Dashboards screen opens through this: loading, the app's not-found page, or the screen. */

import { UiPageLoading, UiPageNotFound } from "@langwatch/ui-kernel/page-fallbacks";
import type { ReactNode } from "react";

import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import {
  DASHBOARDS_FLAG,
  DASHBOARDS_PERMISSION,
  dashboardsAccess,
} from "../../model/dashboards-access.ts";

export function DashboardsGate({ children }: { children: ReactNode }) {
  const host = useAnalyticsHost();
  const access = dashboardsAccess({
    flag: host.featureFlag(DASHBOARDS_FLAG),
    isSettled: host.isSettled(),
    canView: host.hasPermission(DASHBOARDS_PERMISSION),
  });

  if (access === "loading" || !host.project()) return <UiPageLoading />;
  if (access === "not-found") return <UiPageNotFound />;
  return <>{children}</>;
}
