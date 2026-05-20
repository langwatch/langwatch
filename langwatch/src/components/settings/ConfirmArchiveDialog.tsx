import { Button, HStack, Text, VStack } from "@chakra-ui/react";
import { Dialog } from "../ui/dialog";

export function ConfirmArchiveDialog({
  open,
  onClose,
  onConfirm,
  isLoading,
  entityType,
  entityName,
  description,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isLoading: boolean;
  entityType: string;
  entityName: string;
  description: string;
}) {
  return (
    <Dialog.Root
      size="lg"
      open={open}
      onOpenChange={({ open }) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Content bg="bg">
        <Dialog.Header>
          <Dialog.Title>Archive {entityType}</Dialog.Title>
        </Dialog.Header>
        <Dialog.CloseTrigger />
        <Dialog.Body paddingBottom={6}>
          <VStack gap={4} align="start">
            <Text>
              Are you sure you want to archive{" "}
              <Text as="span" fontWeight="semibold">
                &quot;{entityName}&quot;
              </Text>
              ? {description}
            </Text>
            <HStack width="full" justify="end" gap={2}>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                colorPalette="red"
                onClick={onConfirm}
                disabled={isLoading}
              >
                {isLoading ? "Archiving..." : "Archive"}
              </Button>
            </HStack>
          </VStack>
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  );
}
