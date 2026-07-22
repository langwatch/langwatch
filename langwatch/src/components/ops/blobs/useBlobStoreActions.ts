import { toaster } from "~/components/ui/toaster";
import { api } from "~/utils/api";

/**
 * The two destructive calls the payload store offers, with their operator
 * feedback and cache invalidation attached.
 *
 * Kept out of the rendering components so a change to what an operator is told
 * after a sweep is not a change to the table.
 */
export function useBlobStoreActions({
  onCleanupSuccess,
  onDeleteSuccess,
}: {
  onCleanupSuccess: () => void;
  onDeleteSuccess: () => void;
}) {
  const utils = api.useContext();

  const cleanup = api.ops.runBlobCleanup.useMutation({
    onSuccess: (report) => {
      toaster.create({
        title: report.dryRun
          ? `Preview: ${report.totals.reclaimed} would be deleted`
          : `Reclaimed ${report.totals.reclaimed}, shortened ${report.totals.repaired}`,
        type: "success",
      });
      onCleanupSuccess();
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
    onSuccess: (result) => {
      toaster.create({
        title: result.deleted
          ? "Payload deleted"
          : "Not deleted, something still references it",
        type: result.deleted ? "success" : "warning",
      });
      onDeleteSuccess();
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
