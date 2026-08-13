import { useState } from "react";
import { toaster } from "~/components/ui/toaster";
import { showErrorToast } from "~/features/errors";
import { api } from "~/utils/api";

export interface ProcessInstanceTarget {
  processName: string;
  projectId: string;
  processKey: string;
}

/** The drawer's mutations and confirm state; returns state and callbacks only. */
export function useProcessInstanceActions() {
  const utils = api.useUtils();
  const [confirmAction, setConfirmAction] = useState<"wake" | "redrive" | null>(
    null,
  );

  const wakeMutation = api.ops.processWakeNow.useMutation({
    onSuccess: (data) => {
      toaster.create({
        title: data.woke
          ? "Wake scheduled for now"
          : "Instance no longer exists",
        type: data.woke ? "success" : "error",
      });
      setConfirmAction(null);
      void utils.ops.invalidate();
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't wake the process" }),
  });

  const redriveInstanceMutation =
    api.ops.processRedriveDeadInstance.useMutation({
      onSuccess: (data) => {
        toaster.create({
          title:
            data.requeued > 0
              ? `Redrove ${data.requeued} dead messages`
              : "No dead messages to redrive",
          type: "success",
        });
        setConfirmAction(null);
        void utils.ops.invalidate();
      },
      onError: (error) =>
        showErrorToast({
          error,
          fallbackTitle: "Couldn't redrive the dead messages",
        }),
    });

  const redriveMessageMutation = api.ops.processRedriveDeadMessage.useMutation({
    onSuccess: (data) => {
      toaster.create({
        title: data.redriven ? "Message redriven" : "Message is no longer dead",
        type: data.redriven ? "success" : "error",
      });
      void utils.ops.invalidate();
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't redrive the message" }),
  });

  const releaseLeaseMutation = api.ops.processReleaseLapsedLease.useMutation({
    onSuccess: (data) => {
      toaster.create({
        title: data.released
          ? "Lease released — message due now"
          : "Lease is no longer lapsed",
        type: data.released ? "success" : "error",
      });
      void utils.ops.invalidate();
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't release the lease" }),
  });

  return {
    confirmAction,
    setConfirmAction,
    wakeMutation,
    redriveInstanceMutation,
    redriveMessageMutation,
    releaseLeaseMutation,
  };
}
