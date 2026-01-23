import { Alert, Button, Text, VStack } from "@chakra-ui/react";
import { Dialog } from "../ui/dialog";

interface RegenerateApiKeyDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isLoading?: boolean;
}

export function RegenerateApiKeyDialog({
  open,
  onClose,
  onConfirm,
  isLoading = false,
}: RegenerateApiKeyDialogProps) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={({ open: isOpen }) => !isOpen && onClose()}
      placement="center"
    >
      {open && (
        <Dialog.Content>
          <Dialog.CloseTrigger />
          <Dialog.Header>
            <Dialog.Title>Regenerate API Key?</Dialog.Title>
          </Dialog.Header>
          <Dialog.Body>
            <VStack align="start" gap={4}>
              <Text>
                This will invalidate your current API key immediately. Any
                applications or services using the old key will stop working.
              </Text>
              <Alert.Root status="error" borderRadius="md">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Title>This action cannot be undone</Alert.Title>
                  <Alert.Description>
                    You&apos;ll need to update all applications using this API key.
                  </Alert.Description>
                </Alert.Content>
              </Alert.Root>
            </VStack>
          </Dialog.Body>
          <Dialog.Footer>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              colorPalette="red"
              onClick={onConfirm}
              loading={isLoading}
            >
              Regenerate Key
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      )}
    </Dialog.Root>
  );
}
