import { useState } from "react";

import { api } from "../../../behavior/ops-api";

import { useOpsToaster, useShowErrorToast } from "../../../behavior/ops-feedback";
import { useOpsMutationOutcomes } from "../../../behavior/ops-mutation-outcome";
export interface ProcessInstanceTarget {
  processName: string;
  projectId: string;
  processKey: string;
}

/** Acts on the instance as a whole, both behind the footer's confirmations. */
function useInstanceWideActions(onSettled: () => void) {
  const { countOutcomeHandlers } = useOpsMutationOutcomes();
  const showErrorToast = useShowErrorToast();
  const toaster = useOpsToaster();
  const [confirmAction, setConfirmAction] = useState<"wake" | "redrive" | null>(null);
  const settle = () => {
    setConfirmAction(null);
    onSettled();
  };

  const wakeMutation = api.ops.processWakeNow.useMutation({
    onSuccess: (data) => {
      toaster.create({
        title: data.woke ? "Wake scheduled for now" : "Instance no longer exists",
        type: data.woke ? "success" : "error",
      });
    },
    onError: (error) => showErrorToast({ error, fallbackTitle: "Couldn't wake the process" }),
    onSettled: settle,
  });

  const redriveInstanceMutation = api.ops.processRedriveDeadInstance.useMutation(
    countOutcomeHandlers({
      onSettled: settle,
      title: (n) => (n > 0 ? `Redrove ${n} dead messages` : "No dead messages to redrive"),
      failure: "Couldn't redrive the dead messages",
    }),
  );

  return {
    confirmAction,
    setConfirmAction,
    wakeMutation,
    redriveInstanceMutation,
  };
}

/** Acts on one outbox message, from its own card. */
function useMessageActions(onSettled: () => void) {
  const { mutationOutcomeHandlers } = useOpsMutationOutcomes();
  /**
   * The message a discard is pending on. Discard is the one act here with no
   * way back — no redrive path selects a discarded row — so it asks first,
   * while redrive and release-lease stay one click (both are recoverable).
   */
  const [discardTarget, setDiscardTarget] = useState<{
    id: string;
    intentType: string;
  } | null>(null);

  const redriveMessageMutation = api.ops.processRedriveDeadMessage.useMutation(
    mutationOutcomeHandlers({
      onSettled,
      applied: "Message redriven",
      missed: "Message is no longer dead",
      failure: "Couldn't redrive the message",
    }),
  );

  const discardMessageMutation = api.ops.processDiscardDeadMessage.useMutation(
    mutationOutcomeHandlers({
      onSettled: () => {
        setDiscardTarget(null);
        onSettled();
      },
      applied: "Message discarded",
      missed: "Message is no longer dead",
      failure: "Couldn't discard the message",
    }),
  );

  const releaseLeaseMutation = api.ops.processReleaseLapsedLease.useMutation(
    mutationOutcomeHandlers({
      onSettled,
      applied: "Lease released — message due now",
      missed: "Lease is no longer lapsed",
      failure: "Couldn't release the lease",
    }),
  );

  return {
    discardTarget,
    setDiscardTarget,
    redriveMessageMutation,
    discardMessageMutation,
    releaseLeaseMutation,
  };
}

/** The drawer's mutations and confirm state; returns state and callbacks only. */
export function useProcessInstanceActions() {
  const utils = api.useUtils();
  const invalidate = () => void utils.ops.invalidate();
  return {
    ...useInstanceWideActions(invalidate),
    ...useMessageActions(invalidate),
  };
}
