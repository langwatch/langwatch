import { useMemo } from "react";

import type { LangyUiActionHandlers } from "~/features/langy/uiActions/types";
import { getWidgetRenderPayloadSchema } from "~/server/analytics/dashboardWidgetRenderActions";
import {
  buildWidgetRenderResult,
  useWidgetRenderReceiptStore,
} from "./widgetRenderReceiptStore";

/**
 * The one live UI action the dashboard (Reports) page answers:
 * `dashboard.getWidgetRender` reads the render receipts the mounted widgets
 * published (see `DashboardWidgetFrame`) so an off-screen agent (Langy) can
 * "see" what each card painted. The receipts→result mapping is pure and lives
 * in the store module; this is only the store read plus the scoping.
 *
 * Scoped to `activeDashboardId`: the agent reads the receipts of the dashboard
 * currently open, never another dashboard's cards. `null` (no dashboard chosen
 * yet) lists whatever the tab currently holds, unscoped.
 *
 * Extracted from the Reports page and paired with `DashboardLangyActionsMount`
 * so the registration and its dashboard scoping are unit-testable without the
 * whole page, mirroring the Explorer's `useExplorerLangyActions`.
 */
export function useDashboardLangyActions(
  activeDashboardId: string | null,
): LangyUiActionHandlers {
  return useMemo(
    () => ({
      "dashboard.getWidgetRender": {
        payloadSchema: getWidgetRenderPayloadSchema,
        run: (payload: { widgetId?: string; shouldIncludeMarkup?: boolean }) =>
          buildWidgetRenderResult({
            receipts: useWidgetRenderReceiptStore.getState().receipts,
            dashboardId: activeDashboardId,
            widgetId: payload.widgetId,
            shouldIncludeMarkup: payload.shouldIncludeMarkup,
          }),
      },
    }),
    [activeDashboardId],
  );
}
