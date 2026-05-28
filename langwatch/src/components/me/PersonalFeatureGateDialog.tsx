import { Button, HStack, Text, VStack } from "@chakra-ui/react";

import { Dialog } from "~/components/ui/dialog";

import type { PersonalFeatureKey } from "./usePersonalFeatureGate";

const FEATURE_LABEL: Record<PersonalFeatureKey, string> = {
  evaluations: "Evaluations",
  datasets: "Datasets",
  annotations: "Annotations",
  automations: "Automations",
};

/**
 * Click-to-enable dialog rendered when a user triggers an advanced
 * action on their personal workspace while the bundle is off. Confirm
 * fires `personalWorkspaceFeatures.enableAll` and the original action
 * proceeds inline (modal-flow (b)) — the only follow-up surface is the
 * one the action would have opened anyway (e.g. the Add-to-dataset
 * picker), not a second permission prompt.
 *
 * Spec: specs/ai-gateway/governance/personal-workspace-features.feature
 *       @modal scenarios
 */
export function PersonalFeatureGateDialog({
  state,
}: {
  state: {
    open: boolean;
    feature: PersonalFeatureKey;
    onConfirm: () => void;
    onCancel: () => void;
    isEnabling: boolean;
  };
}) {
  const label = FEATURE_LABEL[state.feature];
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
              {label} is part of the advanced-features bundle for your
              personal workspace. Turning it on enables Evaluations,
              Datasets, Annotations, and Automations together.
            </Text>
            <Text fontSize="xs" color="fg.muted">
              You can disable them later in /me/configure, your data is
              preserved and reappears on re-enable.
            </Text>
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <HStack gap={2}>
            <Button
              variant="ghost"
              size="sm"
              onClick={state.onCancel}
              disabled={state.isEnabling}
            >
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
