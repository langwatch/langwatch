/**
 * What a board menu's "Move to product…" and "Delete" open: the move dialog and the delete
 * confirmation, for the library and the product sidebars alike. The opener owns which board
 * each is open for. @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";

import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { useLibraryDelete, useLibraryMove } from "../../behavior/use-library-writes.ts";
import type { LibraryBoard } from "../../model/organization-library.ts";
import { MoveBoardDialog } from "./move-board-dialog.tsx";

const deleteMessage = (name: string) =>
  `Delete "${name}" and every widget on it? This cannot be undone.`;

export function BoardMenuDialogs({
  pendingMove,
  onSettleMove,
  pendingDelete,
  onSettleDelete,
}: {
  pendingMove: LibraryBoard | undefined;
  onSettleMove: () => void;
  pendingDelete: LibraryBoard | undefined;
  onSettleDelete: () => void;
}) {
  const host = useAnalyticsHost();
  const moving = useLibraryMove();
  const deleting = useLibraryDelete();
  return (
    <>
      {pendingMove && (
        <MoveBoardDialog
          key={pendingMove.id}
          board={pendingMove}
          userId={host.userId()}
          isMoving={moving.isMoving}
          onMove={(homeProduct) => moving.moveBoard({ board: pendingMove, homeProduct })}
          onClose={onSettleMove}
        />
      )}
      <ConfirmDialog
        open={pendingDelete !== void 0}
        onOpenChange={(isOpen) => {
          if (!isOpen) onSettleDelete();
        }}
        title="Delete dashboard"
        message={deleteMessage(pendingDelete?.name ?? "")}
        confirmLabel="Delete"
        tone="danger"
        loading={deleting.isDeleting}
        onConfirm={() => {
          if (!pendingDelete) return;
          deleting.deleteBoard({ board: pendingDelete, onDeleted: onSettleDelete });
        }}
      />
    </>
  );
}
