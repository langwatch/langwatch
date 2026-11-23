/**
 * The `/dashboards` library's create and delete over `boards.*`. A new board is stored in the
 * store project (`use-store-project.ts`); a delete goes to the board's own project.
 * Failures travel raw to the host (#5984). ADR-002, `dashboards-organization-area.feature`.
 */

import { useUiAnalytics } from "@langwatch/browser-host/analytics";
import type { DashboardScope } from "@langwatch/dashboard-contract";

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import { dashboardsPath, organizationBoardPath } from "../model/boards.ts";
import { dashboardCreated, dashboardDeleted } from "../model/dashboard-usage-events.ts";
import type { LibraryBoard } from "../model/organization-library.ts";
import { useStoreProject } from "./use-store-project.ts";

/** Re-reads the library after a write, so the list shows it. */
function useLibraryRefresh() {
  const utils = analyticsApi.useUtils();
  const organizationId = useAnalyticsHost().organizationId() ?? "";
  return () => utils.boards.listInOrganization.invalidate({ organizationId });
}

export function useLibraryCreate() {
  const host = useAnalyticsHost();
  const analytics = useUiAnalytics();
  const refresh = useLibraryRefresh();
  const { storeProject } = useStoreProject();
  const create = analyticsApi.boards.create.useMutation();
  const createAtScope = analyticsApi.boards.createAtScope.useMutation();

  /** Makes the board at the scope picked, in one write, and opens it; true once it is made. */
  const createBoard = async ({ name, scope }: { name: string; scope: DashboardScope }) => {
    if (!storeProject) return false;
    const projectId = storeProject.id;
    try {
      // Another scope also asks analytics:update, so a seat refused it is refused before a write.
      const { id: dashboardId } =
        scope === "PROJECT"
          ? await create.mutateAsync({ projectId, name })
          : await createAtScope.mutateAsync({ projectId, name, scope });
      analytics.track(dashboardCreated({ createdFrom: "blank" }));
      void refresh();
      host.succeeded({ title: "Dashboard created" });
      // Only a Project board lives at its project's address (ADR-002, decision 4).
      host.navigate(
        scope === "PROJECT"
          ? dashboardsPath({ projectSlug: storeProject.slug, dashboardId })
          : organizationBoardPath({ dashboardId }),
      );
      return true;
    } catch (error) {
      host.failed({ error, fallbackTitle: "Couldn't create the dashboard" });
      return false;
    }
  };

  return { createBoard, isCreating: create.isPending || createAtScope.isPending };
}

export function useLibraryDelete() {
  const host = useAnalyticsHost();
  const analytics = useUiAnalytics();
  const utils = analyticsApi.useUtils();
  const refresh = useLibraryRefresh();
  const remove = analyticsApi.boards.delete.useMutation();

  const deleteBoard = ({ board, onDeleted }: { board: LibraryBoard; onDeleted: () => void }) => {
    if (!board.project) return;
    remove.mutate(
      { projectId: board.project.id, dashboardId: board.id },
      {
        onSuccess: () => {
          analytics.track(dashboardDeleted());
          host.succeeded({ title: `"${board.name}" deleted` });
          void refresh();
          // The plan limit counts dashboards, so a delete frees an allowance.
          void utils.licenseEnforcement.checkLimit.invalidate();
          onDeleted();
        },
        onError: (error) => host.failed({ error, fallbackTitle: "Couldn't delete the dashboard" }),
      },
    );
  };

  return { deleteBoard, isDeleting: remove.isPending };
}
