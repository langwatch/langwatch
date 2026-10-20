import { Dialog } from "@langwatch/design-system/dialog";
import { Box, Icon, Text, VStack } from "@langwatch/design-system/primitives";
import { AlertTriangle } from "lucide-react";

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
    <Dialog
      open={open}
      onClose={onClose}
      title="Model provider not ready"
      secondaryAction={{ label: "Proceed anyway", onClick: onProceedAnyway }}
      primaryAction={{
        label: "Configure model provider",
        href: "/settings/model-providers",
        target: "_blank",
        rel: "noopener noreferrer",
        "data-testid": "model-provider-required-modal-configure-button",
      }}
    >
      <VStack gap={4} py={4} align="center" justify="center">
        <Box p={3} borderRadius="full" bg="orange.subtle" color="orange.fg">
          <Icon as={AlertTriangle} boxSize={6} />
        </Box>
        <Text color="fg.muted" fontSize="sm" textAlign="center">
          Scenarios need an enabled provider with a default model to run. Configure default model
          provider to get started, or proceed to create a new scenario anyway.
        </Text>
      </VStack>
    </Dialog>
  );
}
