/**
 * The `/dashboards` library's star and rename on a board row, over the `boards.*` writes the
 * sidebar already uses. A star is written where the board opens, a rename in the project that
 * owns it. Failures travel raw to the host (#5984).
 */

import { useUiAnalytics } from "@langwatch/browser-host/analytics";

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import { dashboardEdited, dashboardFavourited } from "../model/dashboard-usage-events.ts";
import type { LibraryBoard } from "../model/organization-library.ts";

export function useLibraryBoardEdits() {
  const host = useAnalyticsHost();
  const analytics = useUiAnalytics();
  const utils = analyticsApi.useUtils();
  const organizationId = host.organizationId() ?? "";
  const starMutation = analyticsApi.boards.star.useMutation();
  const unstarMutation = analyticsApi.boards.unstar.useMutation();
  const rename = analyticsApi.boards.update.useMutation();

  // Every project's star list too, so each sidebar shows the change without a reload.
  const refresh = () =>
    Promise.all([
      utils.boards.listInOrganization.invalidate({ organizationId }),
      utils.boards.listStarred.invalidate(),
    ]);

  const toggleStar = (board: LibraryBoard) => {
    if (!board.openProject) return;
    const starred = board.starPosition === null;
    const mutation = starred ? starMutation : unstarMutation;
    mutation.mutate(
      { projectId: board.openProject.id, star: { kind: "board", dashboardId: board.id } },
      {
        onSuccess: () => {
          analytics.track(dashboardFavourited({ starred }));
          void refresh();
        },
        onError: (error) => host.failed({ error, fallbackTitle: "Couldn't change your stars" }),
      },
    );
  };

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

  return { toggleStar, renameBoard };
}
