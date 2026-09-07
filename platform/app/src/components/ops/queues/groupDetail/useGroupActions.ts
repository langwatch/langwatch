import { useState } from "react";
import { toaster } from "~/components/ui/toaster";
import { showErrorToast } from "~/features/errors";
import { api } from "~/utils/api";

export interface GroupTarget {
  queueName: string;
  groupId: string;
}

/**
 * The drawer's mutations and their confirm state, off in a hook so the drawer
 * component stays composition-only. Returns state and callbacks, never JSX.
 */
export function useGroupActions(target: GroupTarget) {
  const utils = api.useUtils();
  const [confirmAction, setConfirmAction] = useState<"drain" | "dlq" | null>(
    null,
  );

  const unblockMutation = api.ops.unblockGroup.useMutation({
    onSuccess: () => {
      toaster.create({ title: "Group unblocked", type: "success" });
      void utils.ops.invalidate();
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't unblock the group" }),
  });
  const drainMutation = api.ops.drainGroup.useMutation({
    onSuccess: (data) => {
      toaster.create({
        title: `Drained, removed ${data.jobsRemoved} jobs`,
        type: "success",
      });
      setConfirmAction(null);
      void utils.ops.invalidate();
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't drain the group" }),
  });
  const moveToDlqMutation = api.ops.moveToDlq.useMutation({
    onSuccess: (data) => {
      toaster.create({
        title: `Moved ${data.jobsMoved} jobs to the dead-letter queue`,
        type: "success",
      });
      setConfirmAction(null);
      void utils.ops.invalidate();
    },
    onError: (error) =>
      showErrorToast({
        error,
        fallbackTitle: "Couldn't move the group to the dead-letter queue",
      }),
  });

  const copyGroupId = () => {
    navigator.clipboard.writeText(target.groupId).then(
      () => toaster.create({ title: "Group ID copied", type: "success" }),
      () =>
        toaster.create({ title: "Couldn't copy the group ID", type: "error" }),
    );
  };

  return {
    confirmAction,
    setConfirmAction,
    unblockMutation,
    drainMutation,
    moveToDlqMutation,
    copyGroupId,
  };
}
