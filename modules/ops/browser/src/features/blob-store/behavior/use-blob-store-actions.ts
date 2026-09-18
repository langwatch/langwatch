import { api } from "../../../behavior/ops-api.ts";

import { useOpsToaster, useShowErrorToast } from "../../../behavior/ops-feedback.ts";
interface CleanupVariables {
  // Optional to match the tRPC input, where `dryRun` carries a Zod default and
  // so is not required at the call site. The caller keys off `dryRun === false`,
  // so only the destructive run — never a preview — clears the confirm prompt.
  dryRun?: boolean;
}

interface DeleteVariables {
  queueName: string;
  projectId: string;
  hash: string;
}

/** Two destructive payload-store calls with operator feedback and cache
 * invalidation. Callbacks receive variables to close only their own dialog. */
export function useBlobStoreActions({
  onCleanupSuccess,
  onDeleteSuccess,
}: {
  onCleanupSuccess: (variables: CleanupVariables) => void;
  onDeleteSuccess: (variables: DeleteVariables) => void;
}) {
  const showErrorToast = useShowErrorToast();
  const toaster = useOpsToaster();
  const utils = api.useUtils();

  const cleanup = api.ops.runBlobCleanup.useMutation({
    onSuccess: (report, variables) => {
      toaster.create({
        title: report.dryRun
          ? `Preview: ${report.totals.reclaimed} would be deleted`
          : `Reclaimed ${report.totals.reclaimed}, shortened ${report.totals.repaired}`,
        type: "success",
      });
      onCleanupSuccess(variables);
      void utils.ops.invalidate();
    },
    onError: (error) => {
      showErrorToast({ error, fallbackTitle: "Couldn't run the cleanup" });
    },
  });

  const deleteBlob = api.ops.deleteBlob.useMutation({
    onSuccess: (result, variables) => {
      toaster.create({
        title: result.deleted ? "Payload deleted" : "Not deleted, something still references it",
        type: result.deleted ? "success" : "warning",
      });
      onDeleteSuccess(variables);
      void utils.ops.invalidate();
    },
    onError: (error) => {
      showErrorToast({ error, fallbackTitle: "Couldn't delete this payload" });
    },
  });

  return { cleanup, deleteBlob };
}
