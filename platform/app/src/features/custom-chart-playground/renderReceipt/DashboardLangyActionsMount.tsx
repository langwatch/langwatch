import type React from "react";

import { useRegisterLangyActions } from "~/features/langy/LangyContext";
import { useDashboardLangyActions } from "./useDashboardLangyActions";

/**
 * Registers the dashboard's `dashboard.getWidgetRender` UI action with Langy
 * for as long as the Reports page is open, scoped to the open dashboard, and
 * clears it when the page closes so a dispatch made while the user is
 * elsewhere goes unclaimed and takes its away form instead.
 */
export const DashboardLangyActionsMount: React.FC<{
  activeDashboardId: string | null;
}> = ({ activeDashboardId }) => {
  useRegisterLangyActions(useDashboardLangyActions(activeDashboardId));
  return null;
};
