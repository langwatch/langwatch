/**
 * Who sees one board, and the write that changes it (`dashboards.setVisibility`).
 * A refusal stays with the header control, so the member reads it where they acted; the
 * sidebar menu closes on pick, so it hands the refusal to the host. Words come from the code.
 */

import type { DashboardVisibility } from "@langwatch/dashboard-contract";

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import { BOARD_ADMIN_PERMISSION, canManageBoard } from "../model/board-visibility.ts";
import type { SavedBoard } from "./use-saved-dashboards.ts";

export function useBoardVisibility({
  board,
  reportsRefusal = false,
}: {
  board: SavedBoard;
  /** Hands a refusal to the host's notice, for a control that closes as the member picks. */
  reportsRefusal?: boolean;
}) {
  const host = useAnalyticsHost();
  const projectId = host.project()?.id ?? "";
  const utils = analyticsApi.useUtils();
  const change = analyticsApi.dashboards.setVisibility.useMutation({
    onSuccess: () => utils.dashboards.getAll.invalidate({ projectId }),
    onError: (error) => {
      if (reportsRefusal)
        host.failed({ error, fallbackTitle: "Couldn't change who sees the dashboard" });
    },
  });

  return {
    visibility: change.isPending ? change.variables.visibility : board.visibility,
    canChange: canManageBoard({
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
