import { Drawer } from "@langwatch/design-system/drawer";

import { api } from "../../../../behavior/ops-api.ts";
import { useOpsHost } from "../../../../model/ops-host.ts";
import { useRetryUpgradeStep } from "../../behavior/use-retry-upgrade-step.ts";
import { UpgradeReadState } from "./upgrade-read-state.tsx";
import { UpgradeStepDetail } from "./upgrade-step-detail.tsx";

/** The address key the step drawer opens under (`?upgradeStep=<id>`). */
export const UPGRADE_STEP_OVERLAY = "upgradeStep";

/** W3: one step over whichever Upgrades page opened it; an `ops:manage` reader may retry it. */
export function UpgradeStepDrawer({ stepId, onClose }: { stepId: string; onClose: () => void }) {
  const step = api.ops.upgrade.getStep.useQuery({ id: stepId });
  const canManage = useOpsHost().isOpsAdmin();
  const { retryStep, retryingStepId } = useRetryUpgradeStep();
  const retryable = canManage && step.data?.status === "failed";
  return (
    <Drawer
      title={stepId}
      eyebrow={{ label: "Upgrade step" }}
      size="lg"
      onClose={onClose}
      footer={
        retryable
          ? {
              primaryAction: {
                label: "Retry",
                loading: retryingStepId === stepId,
                onClick: () => retryStep(stepId),
                "data-testid": "upgrade-step-retry",
              },
            }
          : undefined
      }
    >
      <UpgradeReadState read={step} failedTitle="The step could not load">
        {(detail) => <UpgradeStepDetail step={detail} />}
      </UpgradeReadState>
    </Drawer>
  );
}
