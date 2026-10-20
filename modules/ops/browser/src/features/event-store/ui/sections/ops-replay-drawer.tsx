import { Drawer } from "@langwatch/design-system/drawer";

import { ReplayWizardContent } from "./replay-wizard-content.tsx";

/**
 * Projection replay as a drawer (URL-routed via `?replay=open`, so retired
 * /ops/projections links still land here). Status, start-a-replay and run
 * history stack top to bottom; per-run progress keeps /ops/projections/:runId.
 */
export function OpsReplayDrawer({ onClose }: { onClose: () => void }) {
  return (
    <Drawer onClose={onClose} size="xl" title="Projection replay">
      <ReplayWizardContent />
    </Drawer>
  );
}
