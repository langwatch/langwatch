import { useState } from "react";

/** Where the author was headed when the discard confirmation opened. */
export type DiscardTarget = "close" | "createNew";

/** Holds a leave (close, or start a new automation) behind a confirmation while the draft has unsaved changes. */
export function useDiscardGuard({
  isDirty,
  onClose,
  onCreateNew,
}: {
  isDirty: boolean;
  onClose: () => void;
  onCreateNew: () => void;
}) {
  const [pendingTarget, setPendingTarget] = useState<DiscardTarget | null>(
    null,
  );
  const leave = (target: DiscardTarget) =>
    target === "close" ? onClose() : onCreateNew();

  return {
    pendingTarget,
    request: (target: DiscardTarget) => {
      if (isDirty) setPendingTarget(target);
      else leave(target);
    },
    keepEditing: () => setPendingTarget(null),
    discard: () => {
      const target = pendingTarget;
      setPendingTarget(null);
      if (target) leave(target);
    },
  };
}
