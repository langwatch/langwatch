import { Dialog } from "@langwatch/design-system/dialog";
import { Text, VStack } from "@langwatch/design-system/primitives";

/**
 * Confirmation before a key's secret is replaced. Open when `apiKey` is non-null; the parent
 * clears it to close. There is no grace period, so the copy says the old secret stops at once.
 */
export function RotateConfirmDialog({
  apiKey,
  isRotating,
  onCancel,
  onConfirm,
}: {
  apiKey: { id: string; name: string } | null;
  isRotating: boolean;
  onCancel: () => void;
  onConfirm: (apiKeyId: string) => void;
}) {
  return (
    <Dialog
      open={!!apiKey}
      onClose={onCancel}
      title="Rotate API key"
      size="md"
      role="alertdialog"
      busy={isRotating}
      primaryAction={{
        label: "Rotate",
        danger: true,
        loading: isRotating,
        onClick: () => apiKey && onConfirm(apiKey.id),
        "data-testid": "api-key-rotate-confirm",
      }}
    >
      <VStack align="start" gap={3}>
        <Text>
          Rotating <strong>{apiKey?.name}</strong> gives it a new secret. The current secret stops
          working immediately, so anything still using it is refused until you update it.
        </Text>
        <Text color="fg.muted">
          The key keeps its name, owner, scopes, permissions, expiry and usage history.
        </Text>
      </VStack>
    </Dialog>
  );
}
