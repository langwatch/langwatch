import { Button, HStack, Text, VStack } from "@chakra-ui/react";
import { Dialog } from "../../../components/ui/dialog";

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
    <Dialog.Root
      size="lg"
      open={!!apiKeyId}
      onOpenChange={({ open }) => {
        if (!open) onCancel();
      }}
    >
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Revoke API Key</Dialog.Title>
        </Dialog.Header>
        <Dialog.CloseTrigger />
        <Dialog.Body paddingBottom={6}>
          <VStack gap={4} align="start">
            <Text>
              Are you sure you want to revoke this API key? Any integration
              using it will stop working immediately.
            </Text>
            <HStack width="full" justify="end" gap={2}>
              <Button variant="outline" onClick={onCancel}>
                Cancel
              </Button>
              <Button
                colorPalette="red"
                onClick={() => apiKeyId && onConfirm(apiKeyId)}
                disabled={isRevoking}
              >
                Revoke
              </Button>
            </HStack>
          </VStack>
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  );
}
