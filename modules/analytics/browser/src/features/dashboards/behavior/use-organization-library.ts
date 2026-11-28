/**
 * The `/dashboards` library's list over `boards.listInOrganization`, its create and duplicate
 * (`use-library-writes.ts`), each made in the store project; delete and move are the board menu
 * dialogs' own. Failures travel raw to the host (#5984). ADR-002, dashboards-organization-area.
 */

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import { libraryBoardOf } from "../model/organization-library.ts";
import { useLibraryCreate, useLibraryDuplicate } from "./use-library-writes.ts";
import { useStoreProject } from "./use-store-project.ts";

export function useOrganizationLibrary() {
  const host = useAnalyticsHost();
  const store = useStoreProject();
  const { storeProject, namesInStore } = store;
  const creating = useLibraryCreate();
  const { duplicateBoard } = useLibraryDuplicate();
  const organizationId = host.organizationId() ?? "";
  const list = analyticsApi.boards.listInOrganization.useQuery(
    { organizationId },
    { enabled: organizationId !== "" },
  );

  return {
    organizationId,
    storeProject,
    storeProjects: store.storeProjects,
    mayShare: store.mayShare,
    boards: (list.data ?? []).map(libraryBoardOf),
    namesInStore,
    // With no organization the read never starts, so it is not loading either.
    isLoading: organizationId !== "" && list.data === void 0 && !list.isError,
    /** Whether a list is held, so a failed read beside it keeps the rows on screen. */
    hasList: list.data !== void 0,
    // A failed store read hides the create paths, so it is said and retried like the list.
    loadError: list.error ?? store.error,
    retry: () => {
      void list.refetch();
      store.retry();
    },
    ...creating,
    duplicateBoard,
  };
}
