/**
 * The `/dashboards` library's rows with what this member may do on each: Star, Rename and Delete
 * on a board, by the grants of the project that owns it; Duplicate wherever a store project is
 * (`onDuplicate` set). Star on a From LangWatch board is kept in the project in view.
 */

import type { DashboardStar } from "@langwatch/dashboard-contract";
import { useState } from "react";

import { type AnalyticsHostApi, useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { useFavourites } from "../../behavior/use-favourites.ts";
import { useLibraryBoardEdits } from "../../behavior/use-library-board-edits.ts";
import { organizationCuratedPath } from "../../model/boards.ts";
import { type CuratedBoard, CURATED_BOARDS } from "../../model/curated-boards.ts";
import {
  isOwnMyDashboard,
  libraryBoardPath,
  type LibraryBoard,
  ownerLabel,
  whoSees,
} from "../../model/organization-library.ts";
import { CuratedLibraryRow, LibraryRow, type LibraryRowActions } from "../blocks/library-row.tsx";

export function LibraryCuratedRow({
  templateId,
  onDuplicate,
}: {
  templateId: string;
  onDuplicate?: (curated: CuratedBoard) => void;
}) {
  const host = useAnalyticsHost();
  const favourites = useFavourites();
  const curated = CURATED_BOARDS.find((board) => board.templateId === templateId);
  const hasProject = host.project() !== void 0;
  // Its page reads the project in view or the store project (`onDuplicate` is set while there
  // is one), so with neither it opens nowhere.
  const opens = hasProject || onDuplicate !== void 0;
  if (!curated) return null;
  // A template's star is kept per project: the one in view, where the sidebar reads it.
  const star: DashboardStar = { kind: "template", templateId };
  const mayStar = hasProject && !favourites.isLoading && !favourites.loadError;
  return (
    <CuratedLibraryRow
      name={curated.name}
      href={opens ? organizationCuratedPath({ templateId }) : void 0}
      {...(mayStar
        ? {
            star: {
              isStarred: favourites.isStarred(star),
              onToggle: () => favourites.toggleStar(star),
            },
          }
        : {})}
      {...(onDuplicate ? { onDuplicate: () => onDuplicate(curated) } : {})}
    />
  );
}

export function LibraryBoardRow({
  board,
  onDuplicate,
  onDelete,
}: {
  board: LibraryBoard;
  onDuplicate?: () => void;
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
      toggleStar: () => edits.toggleStar(board),
      rename: () => setIsRenaming(true),
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
 * and shows Delete disabled; a board that opens nowhere cannot be starred or copied.
 */
function boardRowActions({
  board,
  host,
  on,
}: {
  board: LibraryBoard;
  host: AnalyticsHostApi;
  on: {
    toggleStar: () => void;
    rename: () => void;
    duplicate: (() => void) | undefined;
    delete: () => void;
  };
}): LibraryRowActions {
  const owningProjectId = board.project?.id;
  const mayIn = (permission: string) =>
    owningProjectId !== void 0 && host.hasPermissionIn({ projectId: owningProjectId, permission });
  const isMine = isOwnMyDashboard({ board, userId: host.userId() });
  const canEdit = mayIn("analytics:update");
  const opens = board.openProject !== null;
  const duplicate = opens ? on.duplicate : void 0;
  return {
    ...(opens ? { star: { isStarred: board.starPosition !== null, onToggle: on.toggleStar } } : {}),
    ...(canEdit && !isMine ? { onRename: on.rename } : {}),
    ...(duplicate
      ? { onDuplicate: duplicate, duplicateLabel: canEdit ? "Duplicate" : "Duplicate to edit" }
      : {}),
    ...(mayIn("analytics:delete") ? { remove: isMine ? {} : { onDelete: on.delete } } : {}),
  };
}
