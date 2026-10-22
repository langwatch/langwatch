import { CodePreview } from "@langwatch/design-system/code-preview";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { Drawer } from "@langwatch/design-system/drawer";

import { api } from "../../../../behavior/ops-api.ts";
import { useOpsHost } from "../../../../model/ops-host.ts";
import { useRetryUpgradeStep } from "../../behavior/use-retry-upgrade-step.ts";
import { useUpgradeStepDiagnostics } from "../../behavior/use-upgrade-step-diagnostics.ts";
import { UpgradeReadState } from "./upgrade-read-state.tsx";
import { UpgradeStepDetail } from "./upgrade-step-detail.tsx";

/** The address key the step drawer opens under (`?upgradeStep=<id>`). */
export const UPGRADE_STEP_OVERLAY = "upgradeStep";

/**
 * W3: one step over whichever Upgrades page opened it. Anyone may copy or download its
 * diagnostics; an `ops:manage` reader may retry a failed step or send them to LangWatch.
 */
export function UpgradeStepDrawer({ stepId, onClose }: { stepId: string; onClose: () => void }) {
  const step = api.ops.upgrade.getStep.useQuery({ id: stepId });
  const canManage = useOpsHost().isOpsAdmin();
  const { retryStep, retryingStepId } = useRetryUpgradeStep();
  const diagnostics = useUpgradeStepDiagnostics({ stepId });
  const failed = step.data?.status === "failed";
  const retryable = canManage && failed;
  return (
    <Drawer
      title={stepId}
      eyebrow={{ label: "Upgrade step" }}
      size="lg"
      onClose={onClose}
      footer={{
        ...(retryable
          ? {
              primaryAction: {
                label: "Retry",
                loading: retryingStepId === stepId,
                onClick: () => retryStep(stepId),
                "data-testid": "upgrade-step-retry",
              },
            }
          : {}),
        ...(canManage && failed && diagnostics.canSend
          ? {
              secondaryAction: {
                label: "Send to LangWatch",
                onClick: () => void diagnostics.review(),
                "data-testid": "upgrade-step-send-diagnostics",
              },
            }
          : {}),
        utilityActions: [
          {
            label: "Copy diagnostics",
            onClick: () => void diagnostics.copy(),
            "data-testid": "upgrade-step-copy-diagnostics",
          },
          {
            label: "Download diagnostics",
            onClick: () => void diagnostics.download(),
            "data-testid": "upgrade-step-download-diagnostics",
          },
        ],
      }}
    >
      <UpgradeReadState read={step} failedTitle="The step could not load">
        {(detail) => <UpgradeStepDetail step={detail} />}
      </UpgradeReadState>
      <ConfirmDialog
        open={diagnostics.preview !== null}
        onClose={diagnostics.closePreview}
        onConfirm={diagnostics.confirmSend}
        title="Send these diagnostics to LangWatch?"
        description="This is everything that is sent. Secrets are masked, but the error, report and log lines can still mention an identifier such as a project id. Review them before you send."
        confirmLabel="Send"
        tone="default"
        loading={diagnostics.sending}
      >
        <CodePreview
          code={diagnostics.preview ?? ""}
          language="json"
          filename="Diagnostics"
          compact
          maxHeight="360px"
        />
      </ConfirmDialog>
    </Drawer>
  );
}
