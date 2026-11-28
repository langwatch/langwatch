/**
 * The boards this project lists for the member and the writes the sidebar and board offer,
 * over the `boards.*` procedures: the project's own, and apart from them the Organization
 * boards other projects own. Failures travel raw to the host (#5984).
 */

import { useUiAnalytics } from "@langwatch/browser-host/analytics";
import type {
  DashboardHomeProduct,
  DashboardProject,
  DashboardScope,
} from "@langwatch/dashboard-contract";

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import { dashboardDeleted, dashboardEdited } from "../model/dashboard-usage-events.ts";

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
  /** The product whose sidebar lists it, which decides whose data it reads (ADR-002, D2). */
  homeProduct: DashboardHomeProduct;
  organizationId: string | null;
  /** The member whose own My dashboard it is; absent from an older server. */
  myDashboardOfUserId?: string | null;
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
  homeProduct,
  organizationId,
  myDashboardOfUserId,
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
    homeProduct,
    organizationId,
    myDashboardOfUserId,
    ownerProject,
    isStarred,
    updatedAt,
  };
}

export function useSavedDashboards() {
  const host = useAnalyticsHost();
  const analytics = useUiAnalytics();
  const project = host.project();
  const projectId = project?.id ?? "";
  const projectSlug = project?.slug ?? "";
  const utils = analyticsApi.useUtils();

  const list = analyticsApi.boards.getAll.useQuery(
    { projectId, includeOrganization: true },
    { enabled: !!projectId },
  );
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

  const renameBoard = ({ dashboardId, name }: { dashboardId: string; name: string }) => {
    rename.mutate(
      { projectId, dashboardId, name },
      {
        onSuccess: () => {
          analytics.track(dashboardEdited({ change: "rename" }));
          void refresh();
        },
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
          analytics.track(dashboardDeleted());
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
    /** A held list being read again: a board just made elsewhere may not be in it yet. */
    isRefreshing: list.isFetching,
    /** Reads the list again now, for a board the address names that the held list lacks. */
    reread: () => list.refetch(),
    loadError: list.error,
    isDeleting: remove.isPending,
    renameBoard,
    deleteBoard,
  };
}
