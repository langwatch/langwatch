import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import type { DrawerFooterProps } from "@langwatch/design-system/drawer";

import type { GroupTarget, useGroupActions } from "../../behavior/use-group-actions.ts";

type FooterAction = NonNullable<DrawerFooterProps["secondaryActions"]>[number];
type GroupActions = ReturnType<typeof useGroupActions>;

export function GroupActionConfirms({
  target,
  actions,
}: {
  target: GroupTarget;
  actions: GroupActions;
}) {
  return (
    <>
      <ConfirmDialog
        open={actions.confirmAction === "drain"}
        onClose={() => actions.setConfirmAction(null)}
        onConfirm={() => actions.drainMutation.mutate(target)}
        title="Drain Group"
        description={`Permanently remove all jobs from "${target.groupId}". Cannot be undone.`}
        loading={actions.drainMutation.isPending}
      />
      <ConfirmDialog
        open={actions.confirmAction === "dlq"}
        onClose={() => actions.setConfirmAction(null)}
        onConfirm={() => actions.moveToDlqMutation.mutate(target)}
        title="Move Group to Dead-Letter Queue"
        description={`Move all jobs from "${target.groupId}" to the dead-letter queue. They stop processing until replayed from the Dead Letter Queue card.`}
        loading={actions.moveToDlqMutation.isPending}
      />
    </>
  );
}

/** The drawer footer's actions; the confirms above catch the destructive two. */
export function groupDrawerFooter({
  target,
  actions,
  isBlocked,
}: {
  target: GroupTarget;
  actions: GroupActions;
  isBlocked: boolean;
}): DrawerFooterProps {
  const retry: FooterAction = {
    label: "Retry now",
    tone: "success",
    loading: actions.unblockMutation.isPending,
    onClick: () => actions.unblockMutation.mutate(target),
  };
  const deadLetter: FooterAction = {
    label: "Move to dead-letter queue",
    onClick: () => actions.setConfirmAction("dlq"),
  };
  const drain: FooterAction = {
    label: "Drain",
    tone: "danger",
    onClick: () => actions.setConfirmAction("drain"),
  };
  return { secondaryActions: [...(isBlocked ? [retry] : []), deadLetter, drain] };
}
