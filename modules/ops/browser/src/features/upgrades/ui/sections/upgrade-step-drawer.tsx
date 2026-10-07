import { Drawer } from "@langwatch/design-system/drawer";

import { api } from "../../../../behavior/ops-api.ts";
import { UpgradeReadState } from "./upgrade-read-state.tsx";
import { UpgradeStepDetail } from "./upgrade-step-detail.tsx";

/** The address key the step drawer opens under (`?upgradeStep=<id>`). */
export const UPGRADE_STEP_OVERLAY = "upgradeStep";

/** W3: one step, read only, over whichever Upgrades page opened it. */
export function UpgradeStepDrawer({ stepId, onClose }: { stepId: string; onClose: () => void }) {
  const step = api.ops.upgrade.getStep.useQuery({ id: stepId });
  return (
    <Drawer.Root open={true} placement="end" size="lg" onOpenChange={() => onClose()}>
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <Drawer.Title>Upgrade step</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body>
          <UpgradeReadState read={step} failedTitle="The step could not load">
            {(detail) => <UpgradeStepDetail step={detail} />}
          </UpgradeReadState>
        </Drawer.Body>
        <Drawer.CloseTrigger />
      </Drawer.Content>
    </Drawer.Root>
  );
}
