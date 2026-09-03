/**
 * The switch a reviewer is offered when they try to hand rows to a dataset on a
 * personal workspace whose advanced features are still off.
 *
 * A NARROWED FAMILY-LOCAL COPY of
 * `platform/app/src/components/me/PersonalFeatureGateDialog`, which keeps its
 * other callers in the trace explorer. Narrowed to the one feature this family
 * asks about, so the label is a word rather than a lookup over four.
 *
 * Confirm turns the whole bundle on and the original action proceeds inline —
 * the only follow-up surface is the one the action would have opened anyway
 * (the add-to-dataset drawer), never a second permission prompt.
 *
 * Spec: specs/ai-gateway/governance/personal-workspace-features.feature
 *       @modal scenarios.
 */

import { Button, HStack, Text, VStack } from "@chakra-ui/react";
import { Dialog } from "@langwatch/design-system/dialog";
import type { PersonalFeatureGateDialogState } from "../../model/personal-feature-gate-state";

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
