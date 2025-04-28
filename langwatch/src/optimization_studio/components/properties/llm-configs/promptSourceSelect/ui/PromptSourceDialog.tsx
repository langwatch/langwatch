import { VStack } from "@chakra-ui/react";

import { Dialog } from "~/components/ui/dialog";

interface PromptSourceDialogProps {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  children: React.ReactNode;
}

export function PromptSourceDialog({
  open,
  onOpen,
  onClose,
  children,
}: PromptSourceDialogProps) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={({ open }) => (open ? onOpen() : onClose())}
    >
      <Dialog.Content data-testid="prompt-source-dialog">
        <Dialog.Header>
          <Dialog.Title>Select a Prompt</Dialog.Title>
          <Dialog.CloseTrigger />
        </Dialog.Header>
        <Dialog.Body>
          <VStack align="stretch" gap={4} width="full">
            {children}
          </VStack>
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  );
}
