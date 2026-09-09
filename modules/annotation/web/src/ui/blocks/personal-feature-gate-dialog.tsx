/** The confirmation dialog shown before enabling personal-workspace advanced features. */

import { Button, HStack, Text, VStack } from "@chakra-ui/react";
import { Dialog } from "@langwatch/design-system/dialog";
type PersonalFeatureGateDialogState = {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  isEnabling: boolean;
};

export function PersonalFeatureGateDialog({ state }: { state: PersonalFeatureGateDialogState }) {
  return (
    <Dialog.Root
      open={state.open}
      onOpenChange={(details) => {
        if (!details.open) state.onCancel();
      }}
      modal
      size="sm"
    >
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Enable advanced features?</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <VStack align="start" gap={3}>
            <Text fontSize="sm">
              Datasets are part of the advanced-features bundle for your personal workspace. Turning
              it on enables Evaluations, Datasets, Annotations, and Automations together.
            </Text>
            <Text fontSize="xs" color="fg.muted">
              You can disable them later in /me/configure, your data is preserved and reappears on
              re-enable.
            </Text>
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <HStack gap={2}>
            <Button variant="ghost" size="sm" onClick={state.onCancel} disabled={state.isEnabling}>
              Cancel
            </Button>
            <Button
              size="sm"
              colorPalette="blue"
              onClick={state.onConfirm}
              loading={state.isEnabling}
            >
              Enable and continue
            </Button>
          </HStack>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
