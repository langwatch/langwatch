import {
  Box,
  Button,
  HStack,
  Icon,
  Text,
  VStack,
} from "@chakra-ui/react";
import { AlertTriangle } from "lucide-react";
import { Dialog } from "../ui/dialog";

export interface ModelProviderRequiredModalProps {
  open: boolean;
  onClose: () => void;
  onProceedAnyway: () => void;
}

export function ModelProviderRequiredModal({
  open,
  onClose,
  onProceedAnyway,
}: ModelProviderRequiredModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(d) => !d.open && onClose()}>
      <Dialog.Content>
        <Dialog.CloseTrigger />
        <Dialog.Header>
          <Dialog.Title>Model provider not ready</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <VStack gap={4} py={4} align="center" justify="center">
            <Box p={3} borderRadius="full" bg="orange.100" color="orange.600">
              <Icon as={AlertTriangle} boxSize={6} />
            </Box>
            <Text color="fg.muted" fontSize="sm" textAlign="center">
              Scenarios need an enabled provider with a default model to run. Configure default model provider to get started, or proceed to create a new scenario anyway.
            </Text>
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <HStack gap={2} justify="flex-end">
            <Button variant="ghost" onClick={onProceedAnyway}>
              Proceed anyway
            </Button>
            <Button colorPalette="blue" asChild>
              <a
                data-testid="model-provider-required-modal-configure-button"
                href="/settings/model-providers"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "white" }}
              >
                Configure model provider
              </a>
            </Button>
          </HStack>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
