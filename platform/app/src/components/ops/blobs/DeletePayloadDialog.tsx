import { ConfirmDialog } from "~/components/ops/shared/ConfirmDialog";
import type { OpsBlobSummary } from "~/server/app-layer/ops/types";

export function DeletePayloadDialog({
  target,
  onClose,
  onConfirm,
  isLoading,
}: {
  /** The blob awaiting confirmation; null closes the dialog. */
  target: OpsBlobSummary | null;
  onClose: () => void;
  onConfirm: (blob: OpsBlobSummary) => void;
  isLoading: boolean;
}) {
  return (
    <ConfirmDialog
      open={!!target}
      onClose={onClose}
      onConfirm={() => {
        if (target) onConfirm(target);
      }}
      title="Delete this payload"
      description="The job that referenced it will finish without running. This cannot be undone, and it will be refused if anything still references it."
      isLoading={isLoading}
    />
  );
}
