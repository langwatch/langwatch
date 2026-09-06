import { useState } from "react";
import { DeleteConfirmationDialog } from "../components/annotations/DeleteConfirmationDialog";

/**
 * Hook for managing dataset deletion confirmation dialog.
 * @param onDelete Callback function that performs the actual deletion
 * @returns Object with showDeleteDialog function and DeleteDialog component
 */
export function useDeleteDatasetConfirmation(
  onDelete: (params: { id: string; name: string }) => void,
) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [datasetToDelete, setDatasetToDelete] = useState<
    { id: string; name: string } | undefined
  >();

  const showDeleteDialog = ({ id, name }: { id: string; name: string }) => {
    setDatasetToDelete({ id, name });
    setDeleteDialogOpen(true);
  };

  const handleDeleteDataset = () => {
    if (datasetToDelete) {
      onDelete({ id: datasetToDelete.id, name: datasetToDelete.name });
    }
    setDeleteDialogOpen(false);
    setDatasetToDelete(undefined);
  };

  const DeleteDialog = () => (
    <DeleteConfirmationDialog
      title="Are you really sure?"
      description={`Deleting "${
        datasetToDelete?.name ?? "this dataset"
      }" cannot be undone. Type 'delete' below to confirm:`}
      open={deleteDialogOpen}
      onClose={() => {
        setDeleteDialogOpen(false);
        setDatasetToDelete(undefined);
      }}
      onConfirm={handleDeleteDataset}
    />
  );

  return { showDeleteDialog, DeleteDialog };
}
