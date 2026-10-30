/**
 * Sends "dashboards.viewed.dashboard" once per board opened, as soon as its widgets are known,
 * so the count it carries is the board's and not the loading state's.
 * @see modules/dashboard/specs/dashboards-telemetry.feature
 */

import { useUiAnalytics } from "@langwatch/browser-host/analytics";
import { useEffect, useRef } from "react";

import { type DashboardKind, dashboardViewed } from "../model/dashboard-usage-events.ts";

export function useDashboardViewed({
  dashboardId,
  dashboardKind,
  widgetCount,
  isLoaded,
  templateId,
}: {
  dashboardId: string;
  dashboardKind: DashboardKind;
  widgetCount: number;
  /** False while the widgets load; nothing is sent until they are known. */
  isLoaded: boolean;
  templateId?: string;
}): void {
  const analytics = useUiAnalytics();
  const sentFor = useRef<string | undefined>(void 0);

  useEffect(() => {
    if (!isLoaded || sentFor.current === dashboardId) return;
    sentFor.current = dashboardId;
    analytics.track(
      dashboardViewed({
        dashboardKind,
        widgetCount,
        ...(templateId === void 0 ? {} : { templateId }),
      }),
    );
  }, [analytics, dashboardId, dashboardKind, widgetCount, isLoaded, templateId]);
}
