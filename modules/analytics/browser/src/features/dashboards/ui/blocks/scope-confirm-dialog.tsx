/**
 * The confirmation before a change of scope that takes a board from someone: how many other
 * people starred it, or that the other projects stop seeing it. Any other change is made at
 * once and offers Undo. @see modules/dashboard/specs/dashboards-v2.feature AC179
 */

import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";

import type { ScopeConfirmWords } from "../../model/board-scope.ts";

export function ScopeConfirmDialog({
  words,
  isChanging,
  onConfirm,
  onCancel,
}: {
  /** What is asked; absent while no change waits for an answer. */
  words: ScopeConfirmWords | undefined;
  isChanging: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ConfirmDialog
      open={words !== void 0}
      onOpenChange={(isOpen) => {
        if (!isOpen) onCancel();
      }}
      title={words?.title ?? ""}
      message={words?.message ?? ""}
      confirmLabel={words?.confirmLabel ?? ""}
      tone="warning"
      loading={isChanging}
      onConfirm={onConfirm}
    />
  );
}
