import { DeleteConfirmationDialog } from "@langwatch/design-system/delete-confirmation-dialog";

export function DeleteDatasetDialog({
  datasetName,
  open,
  onClose,
  onConfirm,
}: {
  /** Named in the prompt so the reader can see which dataset they are on. */
  datasetName: string | undefined;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <DeleteConfirmationDialog
      open={open}
      onClose={onClose}
      onConfirm={onConfirm}
      closeOnConfirm={false}
      trimConfirmation
      description={`Deleting "${datasetName ?? "this dataset"}" cannot be undone.`}
      inputTestId="delete-dataset-confirmation"
      confirmTestId="delete-dataset-confirm"
    />
  );
}
