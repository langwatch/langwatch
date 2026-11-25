/**
 * A board's icon, chosen from the header's picker and stored through `boards.update` in the
 * project that owns the board. While a save runs the board shows the pick; a refused save
 * travels raw to the host (#5984) and the stored icon shows again.
 * @see modules/dashboard/specs/dashboard-icons.feature
 */

import type { DashboardIcon } from "@langwatch/dashboard-contract";

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import type { SavedBoard } from "./use-saved-dashboards.ts";

export function useBoardIcon({ board }: { board: Pick<SavedBoard, "id" | "projectId" | "icon"> }) {
  const host = useAnalyticsHost();
  const utils = analyticsApi.useUtils();
  const update = analyticsApi.boards.update.useMutation({
    // Returned, so the pick stays shown until the lists hold it: the sidebar reads the library.
    onSuccess: () =>
      Promise.all([
        utils.boards.getAll.invalidate(),
        utils.boards.listStarred.invalidate(),
        utils.boards.listInOrganization.invalidate(),
      ]),
    onError: (error) => host.failed({ error, fallbackTitle: "Couldn't change the icon" }),
  });

  const shown = update.isPending ? (update.variables.icon ?? null) : (board.icon ?? null);
  return {
    icon: shown,
    saveIcon: (next: DashboardIcon | null) => {
      if (next === (board.icon ?? null)) return;
      update.mutate({ projectId: board.projectId, dashboardId: board.id, icon: next });
    },
  };
}
