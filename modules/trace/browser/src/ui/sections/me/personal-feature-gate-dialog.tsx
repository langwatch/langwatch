import { Dialog } from "@langwatch/design-system/dialog";
import { Text, VStack } from "@langwatch/design-system/primitives";

import type { PersonalFeatureKey } from "./use-personal-feature-gate.ts";

const FEATURE_LABEL: Record<PersonalFeatureKey, string> = {
  evaluations: "Evaluations",
  datasets: "Datasets",
  annotations: "Annotations",
  automations: "Automations",
};

// Click-to-enable dialog for advanced actions on personal workspace
// (bundle off).
// Spec: specs/ai-gateway/governance/personal-workspace-features.feature
// (@modal scenarios)
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
    <Dialog
      open={state.open}
      onClose={state.onCancel}
      title="Enable advanced features?"
      busy={state.isEnabling}
      primaryAction={{
        label: "Enable and continue",
        onClick: state.onConfirm,
        loading: state.isEnabling,
      }}
    >
      <VStack align="start" gap={3}>
        <Text fontSize="sm">
          {label} is part of the advanced-features bundle for your personal workspace. Turning it on
          enables Evaluations, Datasets, Annotations, and Automations together.
        </Text>
        <Text fontSize="xs" color="fg.muted">
          You can disable them later in /me/configure, your data is preserved and reappears on
          re-enable.
        </Text>
      </VStack>
    </Dialog>
  );
}
