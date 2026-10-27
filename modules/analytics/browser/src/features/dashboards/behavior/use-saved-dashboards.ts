/**
 * The boards this project lists for the member and the writes the sidebar and board offer,
 * over the `boards.*` procedures: the project's own, and apart from them the Organization
 * boards other projects own. Failures travel raw to the host (#5984).
 */

import type { DashboardProject, DashboardScope } from "@langwatch/dashboard-contract";

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import { dashboardsPath, untitledBoardName } from "../model/boards.ts";
import { withBlockPickerOpen } from "./use-block-picker-address.ts";

/** One stored board, as the list answers it. */
export type SavedBoard = {
  id: string;
  /** The project that owns it; another than the one in view for an Organization board. */
  projectId: string;
  name: string;
  description: string | null;
  /** Null for a board older than creators. */
  createdById: string | null;
  scope: DashboardScope;
  organizationId: string | null;
  /** The owning project, named only where the board is listed in another project. */
  ownerProject: DashboardProject | null;
  /** Whether the member reading the list has starred it. */
  isStarred: boolean;
  /** ISO 8601 off the wire; sorted and formatted without minting a Date. */
  updatedAt: string;
};

/** The fields a board reads off a stored row, whichever procedure answered it. */
function savedBoardOf({
  id,
  projectId,
  name,
  description,
  createdById,
  scope,
  organizationId,
  ownerProject,
  isStarred,
  updatedAt,
}: SavedBoard): SavedBoard {
  return {
    id,
    projectId,
    name,
    description,
    createdById,
    scope,
    organizationId,
    ownerProject,
    isStarred,
    updatedAt,
  };
}

/** How a new board starts: pinned for its maker, and with "Add a widget" open. */
export type CreateBoardOptions = { pin?: boolean; addWidget?: boolean };

export function useSavedDashboards() {
  const host = useAnalyticsHost();
  const project = host.project();
  const projectId = project?.id ?? "";
  const projectSlug = project?.slug ?? "";
  const utils = analyticsApi.useUtils();

  const list = analyticsApi.boards.getAll.useQuery(
    { projectId, includeOrganization: true },
    { enabled: !!projectId },
  );
  const create = analyticsApi.boards.create.useMutation();
  const star = analyticsApi.boards.star.useMutation();
  const rename = analyticsApi.boards.update.useMutation();
  const remove = analyticsApi.boards.delete.useMutation();

  const listed: SavedBoard[] = (list.data ?? []).map(savedBoardOf);
  const boards = listed.filter((board) => board.projectId === projectId);
  const organizationBoards = listed.filter((board) => board.projectId !== projectId);
  const refresh = () =>
    Promise.all([
      utils.boards.getAll.invalidate({ projectId }),
      utils.boards.listStarred.invalidate({ projectId }),
    ]);

  /**
   * Makes a blank board and opens it. `pin` stars it in this project for the maker; a failed
   * pin still opens the board. `addWidget` opens it with "Add a widget" open.
   */
  const createBoard = ({ pin = false, addWidget = false }: CreateBoardOptions = {}) => {
    create.mutate(
      { projectId, name: untitledBoardName({ existingCount: boards.length }) },
      {
        onSuccess: async (created) => {
          if (pin) {
            await star
              .mutateAsync({ projectId, star: { kind: "board", dashboardId: created.id } })
              .catch((error: unknown) =>
                host.failed({ error, fallbackTitle: "Couldn't pin the dashboard" }),
              );
          }
          void refresh();
          const path = dashboardsPath({ projectSlug, dashboardId: created.id });
          host.navigate(addWidget ? withBlockPickerOpen(path) : path);
        },
        onError: (error) => host.failed({ error, fallbackTitle: "Couldn't create the dashboard" }),
      },
    );
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
    /** The project's own boards the member may see. */
    boards,
    /** The Organization boards other projects own, read-only here. */
    organizationBoards,
    /** True until the first list answer arrives, so a board lookup never reads "missing" early. */
    isLoading: list.data === void 0 && !list.isError,
    loadError: list.error,
    isCreating: create.isPending || star.isPending,
    isDeleting: remove.isPending,
    createBoard,
    renameBoard,
    deleteBoard,
  };
}
