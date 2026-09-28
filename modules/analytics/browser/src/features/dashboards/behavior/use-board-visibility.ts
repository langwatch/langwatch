/**
 * Who sees one board, and the write that changes it (`dashboards.setVisibility`).
 * A refusal stays with the control, so the member reads it where they acted;
 * the words come from the error's code (#5984).
 */

import type { DashboardVisibility } from "@langwatch/dashboard-contract";

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import { BOARD_ADMIN_PERMISSION, canChangeBoardVisibility } from "../model/board-visibility.ts";
import type { SavedBoard } from "./use-saved-dashboards.ts";

export function useBoardVisibility({ board }: { board: SavedBoard }) {
  const host = useAnalyticsHost();
  const projectId = host.project()?.id ?? "";
  const utils = analyticsApi.useUtils();
  const change = analyticsApi.dashboards.setVisibility.useMutation({
    onSuccess: () => utils.dashboards.getAll.invalidate({ projectId }),
  });

  return {
    visibility: change.isPending ? change.variables.visibility : board.visibility,
    canChange: canChangeBoardVisibility({
      createdById: board.createdById,
      userId: host.userId(),
      isAdmin: host.hasPermission(BOARD_ADMIN_PERMISSION),
    }),
    refusal: change.error,
    setVisibility: (visibility: DashboardVisibility) => {
      if (visibility === board.visibility) return;
      change.mutate({ projectId, dashboardId: board.id, visibility });
    },
  };
}
