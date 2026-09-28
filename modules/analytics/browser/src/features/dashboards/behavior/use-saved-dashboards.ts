/**
 * The member's own boards and the writes the sidebar and board offer, over the
 * existing `dashboards.*` procedures. Failures travel raw to the host, which
 * resolves their words from the code (#5984).
 */

import type { DashboardVisibility } from "@langwatch/dashboard-contract";

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import { dashboardsPath, untitledBoardName } from "../model/boards.ts";

/** One stored board, as the list answers it. */
export type SavedBoard = {
  id: string;
  name: string;
  description: string | null;
  visibility: DashboardVisibility;
  /** Null for a board older than creators. */
  createdById: string | null;
};

/** The fields a board reads off a stored row, whichever procedure answered it. */
function savedBoardOf({ id, name, description, visibility, createdById }: SavedBoard): SavedBoard {
  return { id, name, description, visibility, createdById };
}

export function useSavedDashboards() {
  const host = useAnalyticsHost();
  const project = host.project();
  const projectId = project?.id ?? "";
  const projectSlug = project?.slug ?? "";
  const utils = analyticsApi.useUtils();

  const list = analyticsApi.dashboards.getAll.useQuery({ projectId }, { enabled: !!projectId });
  const create = analyticsApi.dashboards.create.useMutation();
  const rename = analyticsApi.dashboards.rename.useMutation();
  const remove = analyticsApi.dashboards.delete.useMutation();

  const boards: SavedBoard[] = (list.data ?? []).map(savedBoardOf);
  const refresh = () => utils.dashboards.getAll.invalidate({ projectId });

  const createBoard = () => {
    create.mutate(
      { projectId, name: untitledBoardName({ existingCount: boards.length }) },
      {
        onSuccess: (created) => {
          void refresh();
          host.navigate(dashboardsPath({ projectSlug, dashboardId: created.id }));
        },
        onError: (error) => host.failed({ error, fallbackTitle: "Couldn't create the dashboard" }),
      },
    );
  };

  /** Creates an untitled board without opening it; undefined when the create failed. */
  const createUntitledBoard = async (): Promise<SavedBoard | undefined> => {
    try {
      const created = await create.mutateAsync({
        projectId,
        name: untitledBoardName({ existingCount: boards.length }),
      });
      void refresh();
      return savedBoardOf(created);
    } catch (error) {
      host.failed({ error, fallbackTitle: "Couldn't create the dashboard" });
      return void 0;
    }
  };

  const renameBoard = ({ dashboardId, name }: { dashboardId: string; name: string }) => {
    rename.mutate(
      { projectId, dashboardId, name },
      {
        onSuccess: () => void refresh(),
        onError: (error) => host.failed({ error, fallbackTitle: "Couldn't rename the dashboard" }),
      },
    );
  };

  const deleteBoard = ({
    dashboardId,
    onDeleted,
  }: {
    dashboardId: string;
    onDeleted: () => void;
  }) => {
    remove.mutate(
      { projectId, dashboardId },
      {
        onSuccess: () => {
          void refresh();
          // The plan limit counts dashboards, so a delete frees an allowance.
          void utils.licenseEnforcement.checkLimit.invalidate();
          onDeleted();
        },
        onError: (error) => host.failed({ error, fallbackTitle: "Couldn't delete the dashboard" }),
      },
    );
  };

  return {
    projectSlug,
    boards,
    /** True until the first list answer arrives, so a board lookup never reads "missing" early. */
    isLoading: list.data === void 0 && !list.isError,
    isCreating: create.isPending,
    isDeleting: remove.isPending,
    createBoard,
    createUntitledBoard,
    renameBoard,
    deleteBoard,
  };
}
