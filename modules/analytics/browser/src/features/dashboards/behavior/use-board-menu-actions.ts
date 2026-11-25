/**
 * A board's "⋮" menu for this member: the host's grants in the project that owns the board,
 * read once for the library's rows and the product sidebars' rows alike.
 */

import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import {
  type BoardMenuActions,
  boardMenuActions,
  type BoardMenuHandlers,
  type LibraryBoard,
} from "../model/organization-library.ts";

export function useBoardMenuActions({
  board,
  on,
}: {
  board: LibraryBoard;
  on: BoardMenuHandlers;
}): BoardMenuActions {
  const host = useAnalyticsHost();
  const owningProjectId = board.project?.id;
  const mayInOwner = (permission: string) =>
    owningProjectId !== void 0 && host.hasPermissionIn({ projectId: owningProjectId, permission });
  return boardMenuActions({
    board,
    userId: host.userId(),
    mayEditInOwner: mayInOwner("analytics:update"),
    mayDeleteInOwner: mayInOwner("analytics:delete"),
    on,
  });
}
