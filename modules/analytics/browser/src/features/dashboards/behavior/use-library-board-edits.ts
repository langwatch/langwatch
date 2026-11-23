/**
 * A board's rename, from a library row, a product sidebar row or the board's title, over the
 * `boards.*` write, in the project that owns the board. Failures travel raw to the host (#5984).
 */

import { useUiAnalytics } from "@langwatch/browser-host/analytics";

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import { dashboardEdited } from "../model/dashboard-usage-events.ts";
import type { LibraryBoard } from "../model/organization-library.ts";

/** What a rename reads of a board: a library row or an open board's owning project. */
export type RenamedBoard = Pick<LibraryBoard, "id" | "name"> & {
  readonly project: { readonly id: string } | null;
};

export function useLibraryBoardEdits() {
  const host = useAnalyticsHost();
  const analytics = useUiAnalytics();
  const utils = analyticsApi.useUtils();
  const organizationId = host.organizationId() ?? "";
  const rename = analyticsApi.boards.update.useMutation();

  // Every project's lists too, so the sidebars and an open board show the name without a reload.
  const refresh = () =>
    Promise.all([
      utils.boards.listInOrganization.invalidate({ organizationId }),
      utils.boards.getAll.invalidate(),
      utils.boards.listStarred.invalidate(),
    ]);

  /** Saves a new name in the board's own project; a blank or unchanged one saves nothing. */
  const renameBoard = ({ board, name }: { board: RenamedBoard; name: string }) => {
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
