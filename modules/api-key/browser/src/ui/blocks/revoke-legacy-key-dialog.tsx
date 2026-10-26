import { DeleteConfirmationDialog } from "@langwatch/design-system/delete-confirmation-dialog";

/** Revoking the legacy project key is for good, so the admin types the project name first. */
export function RevokeLegacyKeyDialog({
  open,
  projectName,
  isRevoking,
  onClose,
  onConfirm,
}: {
  open: boolean;
  projectName: string;
  isRevoking: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <DeleteConfirmationDialog
      open={open}
      onClose={onClose}
      onConfirm={onConfirm}
      closeOnConfirm={false}
      title="Revoke the legacy project key?"
      description="Anything still sending this key stops working at once. It cannot be restored."
      confirmationWord={projectName}
      caseSensitive
      trimConfirmation
      confirmLabel="Revoke for good"
      isLoading={isRevoking}
      inputTestId="legacy-key-revoke-name"
      confirmTestId="legacy-key-revoke-confirm"
    />
  );
}
