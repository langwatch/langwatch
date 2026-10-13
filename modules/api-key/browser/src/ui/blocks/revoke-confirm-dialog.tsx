import { Dialog } from "@langwatch/design-system/dialog";
import { Text } from "@langwatch/design-system/primitives";

/**
 * Confirmation modal for revoking an API key. Open when `apiKeyId` is non-null;
 * the parent clears `apiKeyId` to close.
 */
export function RevokeConfirmDialog({
  apiKeyId,
  isRevoking,
  onCancel,
  onConfirm,
}: {
  apiKeyId: string | null;
  isRevoking: boolean;
  onCancel: () => void;
  onConfirm: (apiKeyId: string) => void;
}) {
  return (
    <Dialog
      open={!!apiKeyId}
      onClose={onCancel}
      title="Revoke API key"
      size="md"
      role="alertdialog"
      busy={isRevoking}
      primaryAction={{
        label: "Revoke",
        danger: true,
        loading: isRevoking,
        onClick: () => apiKeyId && onConfirm(apiKeyId),
        "data-testid": "api-key-revoke-confirm",
      }}
    >
      <Text>
        Are you sure you want to revoke this API key? Any integration using it will stop working
        immediately.
      </Text>
    </Dialog>
  );
}
