import { Button, HStack, Text, VStack } from "@chakra-ui/react";
import { Dialog } from "../../../components/ui/dialog";

/**
 * Confirmation modal for revoking a PAT. Open when `patId` is non-null; the
 * parent clears `patId` to close.
 */
export function RevokeConfirmDialog({
  patId,
  isRevoking,
  onCancel,
  onConfirm,
}: {
  patId: string | null;
  isRevoking: boolean;
  onCancel: () => void;
  onConfirm: (patId: string) => void;
}) {
  return (
    <Dialog.Root
      size="lg"
      open={!!patId}
      onOpenChange={({ open }) => {
        if (!open) onCancel();
      }}
    >
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Revoke Token</Dialog.Title>
        </Dialog.Header>
        <Dialog.CloseTrigger />
        <Dialog.Body paddingBottom={6}>
          <VStack gap={4} align="start">
            <Text>
              Are you sure you want to revoke this token? Any integration
              using it will stop working immediately.
            </Text>
            <HStack width="full" justify="end" gap={2}>
              <Button variant="outline" onClick={onCancel}>
                Cancel
              </Button>
              <Button
                colorPalette="red"
                onClick={() => patId && onConfirm(patId)}
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
