import { Dialog } from "@langwatch/design-system/dialog";
import { Text } from "@langwatch/design-system/primitives";

/**
 * Revoking the legacy project key swaps it for an API key on the same project,
 * so the reader is told up front that a new key is coming and the old one dies.
 */
export function RevokeLegacyKeyDialog({
  open,
  projectName,
  isRevoking,
  onClose,
  onConfirm,
}: {
  open: boolean;
  projectName: string | undefined;
  isRevoking: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Revoke the legacy project key?"
      size="md"
      role="alertdialog"
      busy={isRevoking}
      primaryAction={{
        label: "Revoke",
        danger: true,
        loading: isRevoking,
        onClick: onConfirm,
        "data-testid": "legacy-key-revoke-confirm",
      }}
    >
      <Text>
        The legacy key stops working at once. We create a new API key for{" "}
        {projectName ?? "this project"} with the same access and show it to you once. Put it
        wherever the legacy key was used.
      </Text>
    </Dialog>
  );
}
