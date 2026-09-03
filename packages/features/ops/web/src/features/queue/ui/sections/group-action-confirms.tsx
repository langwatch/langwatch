import { Button } from "@chakra-ui/react";
import { ConfirmDialog } from "../../../../ui/elements/ops-confirm-dialog";
import type { GroupTarget, useGroupActions } from "../../behavior/use-group-actions";

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
        isLoading={actions.drainMutation.isPending}
      />
      <ConfirmDialog
        open={actions.confirmAction === "dlq"}
        onClose={() => actions.setConfirmAction(null)}
        onConfirm={() => actions.moveToDlqMutation.mutate(target)}
        title="Move Group to Dead-Letter Queue"
        description={`Move all jobs from "${target.groupId}" to the dead-letter queue. They stop processing until replayed from the Dead Letter Queue card.`}
        isLoading={actions.moveToDlqMutation.isPending}
      />
    </>
  );
}

/** The footer's action buttons; the confirms above catch the destructive two. */
export function GroupDrawerActions({
  target,
  actions,
  isBlocked,
}: {
  target: GroupTarget;
  actions: GroupActions;
  isBlocked: boolean;
}) {
  return (
    <>
      {isBlocked && (
        <Button
          variant="outline"
          size="sm"
          colorPalette="green"
          loading={actions.unblockMutation.isPending}
          onClick={() => actions.unblockMutation.mutate(target)}
        >
          Retry now
        </Button>
      )}
      <Button variant="outline" size="sm" onClick={() => actions.setConfirmAction("dlq")}>
        Move to dead-letter queue
      </Button>
      <Button
        variant="outline"
        size="sm"
        colorPalette="red"
        onClick={() => actions.setConfirmAction("drain")}
      >
        Drain
      </Button>
    </>
  );
}
