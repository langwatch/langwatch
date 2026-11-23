/**
 * The `/dashboards` library's list over `boards.listInOrganization`, and what the screen does
 * with a row: create and delete (`use-library-writes.ts`) and duplicate, each into the store
 * project. Failures travel raw to the host (#5984). ADR-002, dashboards-organization-area.
 */

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import { type LibraryBoard, libraryBoardOf } from "../model/organization-library.ts";
import { useBoardFromTemplate } from "./use-board-from-template.ts";
import { useDuplicateCurated } from "./use-duplicate-curated.ts";
import { useLibraryCreate, useLibraryDelete } from "./use-library-writes.ts";
import { useStoreProject } from "./use-store-project.ts";

export function useOrganizationLibrary() {
  const host = useAnalyticsHost();
  const store = useStoreProject();
  const { storeProject, namesInStore } = store;
  const fromTemplate = useBoardFromTemplate({ atOrganization: true, storeProject });
  const curatedCopy = useDuplicateCurated({ store });
  const creating = useLibraryCreate();
  const deleting = useLibraryDelete();
  const organizationId = host.organizationId() ?? "";
  const list = analyticsApi.boards.listInOrganization.useQuery(
    { organizationId },
    { enabled: organizationId !== "" },
  );

  /** Copies the board and its widgets into the store project, keeping its scope, and opens it. */
  const duplicateBoard = (board: LibraryBoard) => {
    if (!board.openProject) return;
    const readFrom = board.openProject.id;
    void fromTemplate.duplicateBoard({ board, existingNames: namesInStore, readFrom });
  };

  return {
    organizationId,
    storeProject,
    boards: (list.data ?? []).map(libraryBoardOf),
    namesInStore,
    // With no organization the read never starts, so it is not loading either.
    isLoading: organizationId !== "" && list.data === void 0 && !list.isError,
    loadError: list.error,
    retry: () => void list.refetch(),
    ...creating,
    ...deleting,
    duplicateBoard,
    duplicateCurated: curatedCopy.duplicate,
  };
}
