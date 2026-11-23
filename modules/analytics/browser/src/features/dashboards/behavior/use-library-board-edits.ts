/**
 * The `/dashboards` library's rename on a board row, over the `boards.*` write the sidebar
 * already uses, in the project that owns the board. Failures travel raw to the host (#5984).
 */

import { useUiAnalytics } from "@langwatch/browser-host/analytics";

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import { dashboardEdited } from "../model/dashboard-usage-events.ts";
import type { LibraryBoard } from "../model/organization-library.ts";

export function useLibraryBoardEdits() {
  const host = useAnalyticsHost();
  const analytics = useUiAnalytics();
  const utils = analyticsApi.useUtils();
  const organizationId = host.organizationId() ?? "";
  const rename = analyticsApi.boards.update.useMutation();

  // Every project's pinned list too, so a sidebar shows the new name without a reload.
  const refresh = () =>
    Promise.all([
      utils.boards.listInOrganization.invalidate({ organizationId }),
      utils.boards.listStarred.invalidate(),
    ]);

  /** Saves a new name in the board's own project; a blank or unchanged one saves nothing. */
  const renameBoard = ({ board, name }: { board: LibraryBoard; name: string }) => {
    const trimmed = name.trim();
    if (!board.project || trimmed === "" || trimmed === board.name) return;
    rename.mutate(
      { projectId: board.project.id, dashboardId: board.id, name: trimmed },
      {
        onSuccess: () => {
          analytics.track(dashboardEdited({ change: "rename" }));
          host.succeeded({ title: "Dashboard renamed" });
          void refresh();
        },
        onError: (error) => host.failed({ error, fallbackTitle: "Couldn't rename the dashboard" }),
      },
    );
  };

  return { renameBoard };
}
