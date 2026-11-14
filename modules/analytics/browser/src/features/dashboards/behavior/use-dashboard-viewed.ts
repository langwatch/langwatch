/**
 * Sends "dashboards.viewed.dashboard" once per board opened, as soon as its widgets are known,
 * so the count it carries is the board's and not the loading state's. It carries the board's
 * one-way key, never its id, so repeat opens of one board count together.
 * @see modules/dashboard/specs/dashboards-telemetry.feature
 */

import { useUiAnalytics } from "@langwatch/browser-host/analytics";
import { useEffect, useRef } from "react";

import {
  type DashboardKind,
  dashboardKey,
  dashboardViewed,
} from "../model/dashboard-usage-events.ts";

/** Sends one view for the board on screen, once its widgets have loaded. */
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
    const view = { dashboardKind, widgetCount, ...(templateId === void 0 ? {} : { templateId }) };
    // A view whose key cannot be made is still a view: it is sent without the key.
    void dashboardKey(dashboardId).then(
      (key) => analytics.track(dashboardViewed({ ...view, dashboardKey: key })),
      () => analytics.track(dashboardViewed(view)),
    );
  }, [analytics, dashboardId, dashboardKind, widgetCount, isLoaded, templateId]);
}
