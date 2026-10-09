import { Drawer } from "@langwatch/design-system/drawer";
import { Button } from "@langwatch/design-system/primitives";

import { api } from "../../../../behavior/ops-api.ts";
import { useOpsToaster } from "../../../../behavior/ops-feedback.ts";
import { useOpsHost } from "../../../../model/ops-host.ts";
import { UpgradeReadState } from "./upgrade-read-state.tsx";
import { UpgradeStepDetail } from "./upgrade-step-detail.tsx";

/** The address key the step drawer opens under (`?upgradeStep=<id>`). */
export const UPGRADE_STEP_OVERLAY = "upgradeStep";

/** W3: one step over whichever Upgrades page opened it; an `ops:manage` reader may retry it. */
export function UpgradeStepDrawer({ stepId, onClose }: { stepId: string; onClose: () => void }) {
  const step = api.ops.upgrade.getStep.useQuery({ id: stepId });
  const canManage = useOpsHost().isOpsAdmin();
  const utils = api.useUtils();
  const toaster = useOpsToaster();
  const retry = api.ops.upgrade.retryStep.useMutation({
    onSuccess: () => void utils.ops.upgrade.invalidate(),
    onError: () => toaster.create({ type: "error", title: "The step could not be retried" }),
  });
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
        {canManage && step.data?.status === "failed" && (
          <Drawer.Footer>
            <Button
              loading={retry.isPending}
              onClick={() => retry.mutate({ id: stepId })}
              data-testid="upgrade-step-retry"
            >
              Retry
            </Button>
          </Drawer.Footer>
        )}
        <Drawer.CloseTrigger />
      </Drawer.Content>
    </Drawer.Root>
  );
}
