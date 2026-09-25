/**
 * The whole setup, start to finish, with no chrome of its own: confirm who
 * you are (only where there is a password to confirm), scan, save the codes.
 */
import { Button, Field, HStack, Input, Text, VStack } from "@chakra-ui/react";
import { useState } from "react";

import { useTwoStepSetup } from "../../behavior/use-two-step-setup.ts";
import { BackupCodesPanel } from "../blocks/backup-codes-panel.tsx";
import { TwoStepSetupPanel } from "../blocks/two-step-setup-panel.tsx";

export function TwoStepSetupFlow({
  holdsPassword,
  onFinished,
  onCancel,
}: {
  holdsPassword: boolean;
  onFinished: () => void;
  onCancel: () => void;
}) {
  const setup = useTwoStepSetup({ onFinished });
  const [password, setPassword] = useState("");

  if (setup.step === "codes") {
    return <BackupCodesPanel codes={setup.backupCodes} onDone={setup.finish} />;
  }

  if (setup.step === "scan") {
    return (
      <TwoStepSetupPanel
        setupUri={setup.setupUri}
        isConfirming={setup.isConfirming}
        onConfirm={(code) => void setup.confirm(code)}
        onCancel={() => {
          setup.reset();
          onCancel();
        }}
      />
    );
  }

  return (
    <VStack align="stretch" gap={4} width="full">
      <Text fontSize="sm">
        Two-step verification asks for a code from your phone as well as whatever you sign in with,
        so somebody who has learned your password still cannot sign in as you.
      </Text>

      {holdsPassword ? (
        <Field.Root>
          <Field.Label>Confirm your password to begin</Field.Label>
          <Input
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
            data-testid="two-factor-password"
          />
        </Field.Root>
      ) : (
        <Text fontSize="sm" color="fg.muted">
          You are signed in already, so there is nothing to confirm first.
        </Text>
      )}

      <HStack gap={3} justify="end">
        <Button variant="outline" onClick={onCancel} disabled={setup.isStarting}>
          Cancel
        </Button>
        <Button
          colorPalette="orange"
          loading={setup.isStarting}
          disabled={holdsPassword && password.length === 0}
          onClick={() => void setup.start(holdsPassword ? password : void 0)}
          data-testid="start-two-factor"
        >
          Continue
        </Button>
      </HStack>
    </VStack>
  );
}
