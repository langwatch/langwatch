/** The confirmation dialog shown before enabling personal-workspace advanced features. */

import { Dialog } from "@langwatch/design-system/dialog";
import { Text, VStack } from "@langwatch/design-system/primitives";

type PersonalFeatureGateDialogState = {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  isEnabling: boolean;
};

export function PersonalFeatureGateDialog({ state }: { state: PersonalFeatureGateDialogState }) {
  return (
    <Dialog
      open={state.open}
      onClose={state.onCancel}
      title="Enable advanced features?"
      size="sm"
      busy={state.isEnabling}
      primaryAction={{
        label: "Enable and continue",
        onClick: state.onConfirm,
        loading: state.isEnabling,
      }}
    >
      <VStack align="start" gap={3}>
        <Text fontSize="sm">
          Datasets are part of the advanced-features bundle for your personal workspace. Turning it
          on enables Evaluations, Datasets, Annotations, and Automations together.
        </Text>
        <Text fontSize="xs" color="fg.muted">
          You can disable them later in /me/configure, your data is preserved and reappears on
          re-enable.
        </Text>
      </VStack>
    </Dialog>
  );
}
