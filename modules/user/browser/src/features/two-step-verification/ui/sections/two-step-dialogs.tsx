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
      <Dialog.Root
        open={isSettingUp}
        onOpenChange={({ open }) => {
          if (!open) onCloseSetup();
        }}
        placement="center"
      >
        <Dialog.Content bg="bg">
          <Dialog.CloseTrigger />
          <Dialog.Header>
            <Dialog.Title fontSize="md" fontWeight="500">
              Set up two-step verification
            </Dialog.Title>
          </Dialog.Header>
          <Dialog.Body paddingBottom={6}>
            {isSettingUp ? (
              <TwoStepSetupFlow
                holdsPassword={holdsPassword}
                onFinished={onFinishedSetup}
                onCancel={onCloseSetup}
              />
            ) : null}
          </Dialog.Body>
        </Dialog.Content>
      </Dialog.Root>
      <Dialog.Root
        open={regenerated.length > 0}
        onOpenChange={({ open }) => {
          if (!open) onCloseCodes();
        }}
        placement="center"
      >
        <Dialog.Content bg="bg">
          <Dialog.CloseTrigger />
          <Dialog.Header>
            <Dialog.Title fontSize="md" fontWeight="500">
              Your new backup codes
            </Dialog.Title>
          </Dialog.Header>
          <Dialog.Body paddingBottom={6}>
            <BackupCodesPanel codes={regenerated} onDone={onCloseCodes} />
          </Dialog.Body>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}
