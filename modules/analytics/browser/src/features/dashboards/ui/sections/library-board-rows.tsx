/**
 * The `/dashboards` library's rows with what this member may do on each: Rename, Move and Delete
 * on a board, by the grants of the project that owns it; Duplicate wherever a store project is
 * (`onDuplicate` set). `boardMenuActions` is that rule, which the product sidebars' rows share.
 */

import { useState } from "react";

import { type AnalyticsHostApi, useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { useLibraryBoardEdits } from "../../behavior/use-library-board-edits.ts";
import {
  isOwnMyDashboard,
  libraryBoardPath,
  type LibraryBoard,
  mayRenameBoard,
  ownerLabel,
  whoSees,
} from "../../model/organization-library.ts";
import type { BoardMenuActions } from "../blocks/board-menu.tsx";
import { LibraryRow } from "../blocks/library-row.tsx";

/** Why a board the member may only view offers no move. */
const VIEW_ONLY_MOVE_REFUSAL = "You can view this dashboard but not change it.";

export function LibraryBoardRow({
  board,
  onDuplicate,
  onMove,
  onDelete,
}: {
  board: LibraryBoard;
  onDuplicate?: () => void;
  onMove: () => void;
  onDelete: () => void;
}) {
  const host = useAnalyticsHost();
  const edits = useLibraryBoardEdits();
  const [isRenaming, setIsRenaming] = useState(false);
  const userId = host.userId();
  const actions = boardMenuActions({
    board,
    host,
    on: {
      rename: () => setIsRenaming(true),
      move: onMove,
      duplicate: onDuplicate,
      delete: onDelete,
    },
  });
  const renaming = {
    onCommit: (name: string) => {
      setIsRenaming(false);
      edits.renameBoard({ board, name });
    },
    onCancel: () => setIsRenaming(false),
  };
  return (
    <LibraryRow
      name={board.name}
      href={libraryBoardPath(board)}
      whoSees={whoSees(board)}
      isPrivate={board.scope === "PRIVATE"}
      owner={ownerLabel({ board, userId })}
      actions={actions}
      renaming={isRenaming ? renaming : void 0}
    />
  );
}

/**
 * A board's menu from the grants of the project that owns it. My dashboard keeps its name and
 * shows Delete disabled; a board that opens nowhere cannot be copied; one the member cannot
 * edit shows Move disabled.
 */
export function boardMenuActions({
  board,
  host,
  on,
}: {
  board: LibraryBoard;
  host: AnalyticsHostApi;
  on: {
    rename: () => void;
    move: () => void;
    duplicate: (() => void) | undefined;
    delete: () => void;
  };
}): BoardMenuActions {
  const owningProjectId = board.project?.id;
  const mayIn = (permission: string) =>
    owningProjectId !== void 0 && host.hasPermissionIn({ projectId: owningProjectId, permission });
  const userId = host.userId();
  const isMine = isOwnMyDashboard({ board, userId });
  const canEdit = mayIn("analytics:update");
  const duplicate = board.openProject !== null ? on.duplicate : void 0;
  return {
    ...(mayRenameBoard({ board, userId, mayEditInOwner: canEdit }) ? { onRename: on.rename } : {}),
    move: canEdit ? { onMove: on.move } : { refusal: VIEW_ONLY_MOVE_REFUSAL },
    ...(duplicate
      ? { onDuplicate: duplicate, duplicateLabel: canEdit ? "Duplicate" : "Duplicate to edit" }
      : {}),
    ...(mayIn("analytics:delete") ? { remove: isMine ? {} : { onDelete: on.delete } } : {}),
  };
}
