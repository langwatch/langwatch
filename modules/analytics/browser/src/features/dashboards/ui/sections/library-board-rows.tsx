/**
 * The `/dashboards` library's rows with what this member may do on each: Rename, Move and Delete
 * on a board, by the grants of the project that owns it; Duplicate wherever a store project is
 * (`onDuplicate` set). The rule is `boardMenuActions`, which the product sidebars' rows share.
 */

import { useState } from "react";

import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { useBoardMenuActions } from "../../behavior/use-board-menu-actions.ts";
import { useLibraryBoardEdits } from "../../behavior/use-library-board-edits.ts";
import {
  HOME_PRODUCT_LABELS,
  libraryBoardPath,
  type LibraryBoard,
  ownerLabel,
  whoSees,
} from "../../model/organization-library.ts";
import { LibraryRow } from "../blocks/library-row.tsx";

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
  const actions = useBoardMenuActions({
    board,
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
      description={board.description}
      href={libraryBoardPath(board)}
      product={HOME_PRODUCT_LABELS[board.homeProduct]}
      whoSees={whoSees(board)}
      isPrivate={board.scope === "PRIVATE"}
      owner={ownerLabel({ board, userId })}
      updatedAt={board.updatedAt}
      actions={actions}
      renaming={isRenaming ? renaming : void 0}
    />
  );
}
