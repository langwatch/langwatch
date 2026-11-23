/**
 * The `/dashboards` library's rows with what this member may do on each: Rename, Move and Delete
 * on a board, by the grants of the project that owns it; Duplicate wherever a store project is
 * (`onDuplicate` set).
 */

import { useState } from "react";

import { type AnalyticsHostApi, useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { useLibraryBoardEdits } from "../../behavior/use-library-board-edits.ts";
import {
  isOwnMyDashboard,
  libraryBoardPath,
  type LibraryBoard,
  ownerLabel,
  whoSees,
} from "../../model/organization-library.ts";
import { LibraryRow, type LibraryRowActions } from "../blocks/library-row.tsx";

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
  const actions = boardRowActions({
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
 * A board row's menu from the grants of the project that owns it. My dashboard keeps its name
 * and shows Delete disabled; a board that opens nowhere cannot be copied; one the member cannot
 * edit shows Move disabled.
 */
function boardRowActions({
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
}): LibraryRowActions {
  const owningProjectId = board.project?.id;
  const mayIn = (permission: string) =>
    owningProjectId !== void 0 && host.hasPermissionIn({ projectId: owningProjectId, permission });
  const isMine = isOwnMyDashboard({ board, userId: host.userId() });
  const canEdit = mayIn("analytics:update");
  const duplicate = board.openProject !== null ? on.duplicate : void 0;
  return {
    ...(canEdit && !isMine ? { onRename: on.rename } : {}),
    move: canEdit ? { onMove: on.move } : { refusal: VIEW_ONLY_MOVE_REFUSAL },
    ...(duplicate
      ? { onDuplicate: duplicate, duplicateLabel: canEdit ? "Duplicate" : "Duplicate to edit" }
      : {}),
    ...(mayIn("analytics:delete") ? { remove: isMine ? {} : { onDelete: on.delete } } : {}),
  };
}
