/** The setup, and a fresh set of backup codes, each in a dialog over the security screen. */
import { Dialog } from "@langwatch/design-system/dialog";

import { BackupCodesPanel } from "../blocks/backup-codes-panel.tsx";
import { TwoStepSetupFlow } from "./two-step-setup-flow.tsx";

export function TwoStepDialogs({
  isSettingUp,
  holdsPassword,
  regenerated,
  onCloseSetup,
  onFinishedSetup,
  onCloseCodes,
}: {
  isSettingUp: boolean;
  holdsPassword: boolean;
  regenerated: readonly string[];
  onCloseSetup: () => void;
  onFinishedSetup: () => void;
  onCloseCodes: () => void;
}) {
  return (
    <>
      <Dialog
        open={isSettingUp}
        onClose={onCloseSetup}
        title="Set up two-step verification"
        placement="center"
        cancelLabel={null}
      >
        {isSettingUp ? (
          <TwoStepSetupFlow
            holdsPassword={holdsPassword}
            onFinished={onFinishedSetup}
            onCancel={onCloseSetup}
          />
        ) : null}
      </Dialog>
      <Dialog
        open={regenerated.length > 0}
        onClose={onCloseCodes}
        title="Your new backup codes"
        placement="center"
        cancelLabel={null}
      >
        <BackupCodesPanel codes={regenerated} onDone={onCloseCodes} />
      </Dialog>
    </>
  );
}
