import { DeleteConfirmationDialog } from "@langwatch/design-system/delete-confirmation-dialog";

export function RunCleanupDialog({
  value,
  onChange,
  onClose,
  onConfirm,
  isLoading,
}: {
  /** What the operator has typed so far; null closes the dialog. */
  value: string | null;
  onChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
  isLoading: boolean;
}) {
  return (
    <DeleteConfirmationDialog
      open={value !== null}
      onClose={onClose}
      onConfirm={onConfirm}
      closeOnConfirm={false}
      title="Run cleanup"
      description="Payloads nothing references will be deleted."
      isLoading={isLoading}
      confirmationWord="RECLAIM"
      caseSensitive
      confirmLabel="Confirm"
      value={value ?? ""}
      onValueChange={onChange}
    />
  );
}
