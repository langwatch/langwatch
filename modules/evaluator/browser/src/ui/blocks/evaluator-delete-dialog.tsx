import { DeleteConfirmationDialog } from "@langwatch/design-system/delete-confirmation-dialog";

export type EvaluatorRelatedEntity = { id: string; name: string };

export type EvaluatorDeleteDialogProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isLoading?: boolean;
  isLoadingRelated?: boolean;
  evaluatorName: string;
  /** The linked workflow, which is ARCHIVED rather than deleted. */
  workflow: EvaluatorRelatedEntity | null;
  /** The online evaluations, which are DELETED. */
  monitors: readonly EvaluatorRelatedEntity[];
};

export function EvaluatorDeleteDialog({
  open,
  onClose,
  onConfirm,
  isLoading = false,
  isLoadingRelated = false,
  evaluatorName,
  workflow,
  monitors,
}: EvaluatorDeleteDialogProps) {
  return (
    <DeleteConfirmationDialog
      open={open}
      onClose={onClose}
      onConfirm={onConfirm}
      closeOnConfirm={false}
      title="Delete evaluator?"
      description={`You are about to delete "${evaluatorName}". This action cannot be undone.`}
      isLoading={isLoading}
      isLoadingRelated={isLoadingRelated}
      inputTestId="cascade-archive-confirm-input"
      confirmTestId="cascade-archive-confirm-button"
      consequences={[
        { label: "Workflows", action: "archived", items: workflow ? [workflow] : [] },
        { label: "Online Evaluations", action: "deleted", items: monitors },
      ]}
    />
  );
}
