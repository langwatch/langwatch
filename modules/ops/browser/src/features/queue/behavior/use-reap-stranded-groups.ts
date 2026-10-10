import { useState } from "react";

import { api } from "../../../behavior/ops-api.ts";
import { useOpsToaster, useShowErrorToast } from "../../../behavior/ops-feedback.ts";
import { describeReapReport } from "../model/queue-reap-report.ts";

/** "Clear stuck groups": confirm, reap, then toast the report. State and callbacks, never JSX. */
export function useReapStrandedGroups() {
  const showErrorToast = useShowErrorToast();
  const toaster = useOpsToaster();
  const utils = api.useUtils();
  const [confirming, setConfirming] = useState(false);

  const reapMutation = api.ops.reapStrandedGroups.useMutation({
    onSuccess: (report) => {
      setConfirming(false);
      toaster.create({
        title: describeReapReport(report),
        type: report.failedDeletes > 0 ? "warning" : "success",
      });
      void utils.ops.invalidate();
    },
    onError: (error) => showErrorToast({ error, fallbackTitle: "Couldn't clear the stuck groups" }),
  });

  return {
    confirming,
    open: () => setConfirming(true),
    close: () => setConfirming(false),
    confirm: () => reapMutation.mutate(),
    isLoading: reapMutation.isPending,
  };
}
