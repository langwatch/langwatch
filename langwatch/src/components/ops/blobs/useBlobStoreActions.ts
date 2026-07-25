import { toaster } from "~/components/ui/toaster";
import { api } from "~/utils/api";

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

/**
 * The two destructive calls the payload store offers, with their operator
 * feedback and cache invalidation attached.
 *
 * Success callbacks receive the variables the completed call ran with. That is
 * what lets the caller close only the dialog that owns the resolved request:
 * both the delete target and the reclaim prompt are single pieces of shared
 * state, so a stale completion (a delete the operator cancelled, a preview that
 * resolves after the Run dialog opened) must not be allowed to close whatever
 * dialog is open now.
 */
export function useBlobStoreActions({
  onCleanupSuccess,
  onDeleteSuccess,
}: {
  onCleanupSuccess: (variables: CleanupVariables) => void;
  onDeleteSuccess: (variables: DeleteVariables) => void;
}) {
  const utils = api.useContext();

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
      toaster.create({
        title: "Cleanup failed",
        description: error.message,
        type: "error",
      });
    },
  });

  const deleteBlob = api.ops.deleteBlob.useMutation({
    onSuccess: (result, variables) => {
      toaster.create({
        title: result.deleted
          ? "Payload deleted"
          : "Not deleted, something still references it",
        type: result.deleted ? "success" : "warning",
      });
      onDeleteSuccess(variables);
      void utils.ops.invalidate();
    },
    onError: (error) => {
      toaster.create({
        title: "Delete failed",
        description: error.message,
        type: "error",
      });
    },
  });

  return { cleanup, deleteBlob };
}
