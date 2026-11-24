/**
 * A board's create, duplicate, delete and move over `boards.*`, from the library or a product
 * sidebar. A new board or copy is stored in the store project (`use-store-project.ts`); a delete
 * goes to the board's own project. Failures travel raw to the host (#5984). ADR-002.
 */

import { useUiAnalytics } from "@langwatch/browser-host/analytics";
import type { DashboardHomeProduct, DashboardScope } from "@langwatch/dashboard-contract";
import { toaster } from "@langwatch/design-system/toaster";

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import { organizationBoardPath } from "../model/boards.ts";
import { dashboardCreated, dashboardDeleted } from "../model/dashboard-usage-events.ts";
import { HOME_PRODUCT_LABELS, type LibraryBoard } from "../model/organization-library.ts";
import { useBoardFromTemplate } from "./use-board-from-template.ts";
import { useStoreProject } from "./use-store-project.ts";

/** Re-reads the library and the written project's lists, so every sidebar and list shows it. */
function useLibraryRefresh() {
  const utils = analyticsApi.useUtils();
  const organizationId = useAnalyticsHost().organizationId() ?? "";
  return ({ projectId }: { projectId: string }) =>
    Promise.all([
      utils.boards.listInOrganization.invalidate({ organizationId }),
      utils.boards.getAll.invalidate({ projectId }),
      utils.boards.listStarred.invalidate({ projectId }),
    ]);
}

export function useLibraryCreate() {
  const host = useAnalyticsHost();
  const analytics = useUiAnalytics();
  const refresh = useLibraryRefresh();
  const { storeProject } = useStoreProject();
  const create = analyticsApi.boards.create.useMutation();
  const createAtScope = analyticsApi.boards.createAtScope.useMutation();

  /** Makes the board at the scope and home picked, in one write, and opens it; true once made. */
  const createBoard = async ({
    name,
    scope,
    homeProduct,
  }: {
    name: string;
    scope: DashboardScope;
    homeProduct: DashboardHomeProduct;
  }) => {
    if (!storeProject) return false;
    const projectId = storeProject.id;
    try {
      // Another scope also asks analytics:update, so a seat refused it is refused before a write.
      const { id: dashboardId } =
        scope === "PROJECT"
          ? await create.mutateAsync({ projectId, name, homeProduct })
          : await createAtScope.mutateAsync({ projectId, name, scope, homeProduct });
      analytics.track(dashboardCreated({ createdFrom: "blank" }));
      void refresh({ projectId });
      host.succeeded({ title: "Dashboard created" });
      // A board made in the library stays in Dashboards, whatever its scope (ADR-002, decision 4).
      host.navigate(organizationBoardPath({ dashboardId }));
      return true;
    } catch (error) {
      host.failed({ error, fallbackTitle: "Couldn't create the dashboard" });
      return false;
    }
  };

  return { createBoard, isCreating: create.isPending || createAtScope.isPending };
}

/** Copies a board and its widgets into the store project, keeping its scope, and opens it. */
export function useLibraryDuplicate() {
  const { storeProject, namesInStore } = useStoreProject();
  const fromTemplate = useBoardFromTemplate({ atOrganization: true, storeProject });

  const duplicateBoard = (board: LibraryBoard) => {
    if (!board.openProject) return;
    const readFrom = board.openProject.id;
    void fromTemplate.duplicateBoard({ board, existingNames: namesInStore, readFrom });
  };

  return { duplicateBoard };
}

export function useLibraryDelete() {
  const host = useAnalyticsHost();
  const analytics = useUiAnalytics();
  const utils = analyticsApi.useUtils();
  const organizationId = host.organizationId() ?? "";
  const remove = analyticsApi.boards.delete.useMutation();

  const deleteBoard = ({ board, onDeleted }: { board: LibraryBoard; onDeleted: () => void }) => {
    if (!board.project) return;
    const projectId = board.project.id;
    remove.mutate(
      { projectId, dashboardId: board.id },
      {
        onSuccess: (deleted) => {
          utils.boards.listInOrganization.setData({ organizationId }, (rows) =>
            rows?.filter((row) => row.id !== deleted.id),
          );
          analytics.track(dashboardDeleted());
          host.succeeded({ title: `"${board.name}" deleted` });
          // Keyed per project, with or without the Organization boards, so these are re-read.
          void utils.boards.getAll.invalidate({ projectId });
          void utils.boards.listStarred.invalidate({ projectId });
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

/** Long enough to read the toast and reach Open; the toast holds while hovered. */
const MOVED_TOAST_MS = 8_000;

export function useLibraryMove() {
  const host = useAnalyticsHost();
  const utils = analyticsApi.useUtils();
  const organizationId = host.organizationId() ?? "";
  const move = analyticsApi.boards.move.useMutation();

  /** Gives the board another home, so that product's sidebar lists it; true once it moved. */
  const moveBoard = async ({
    board,
    homeProduct,
  }: {
    board: LibraryBoard;
    homeProduct: DashboardHomeProduct;
  }) => {
    // Asked in the owning project, as a rename is; the row offers no Move without one.
    if (!board.project) return false;
    const input = { projectId: board.project.id, dashboardId: board.id, homeProduct };
    const moved = await move.mutateAsync(input).catch((error: unknown) => {
      host.failed({ error, fallbackTitle: "Couldn't move the dashboard" });
      return void 0;
    });
    if (!moved) return false;
    // The answer is the library's row; every project's lists are re-read for each sidebar.
    utils.boards.listInOrganization.setData({ organizationId }, (rows) =>
      rows?.map((row) => (row.id === moved.id ? moved : row)),
    );
    void Promise.all([utils.boards.getAll.invalidate(), utils.boards.listStarred.invalidate()]);
    const href = organizationBoardPath({ dashboardId: board.id });
    toaster.create({
      title: `Moved "${board.name}" to ${HOME_PRODUCT_LABELS[homeProduct]}`,
      type: "success",
      duration: MOVED_TOAST_MS,
      action: { label: "Open", onClick: () => host.navigate(href) },
    });
    return true;
  };

  return { moveBoard, isMoving: move.isPending };
}
