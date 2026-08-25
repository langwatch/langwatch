import { Button, Field, HStack, Input, Text, VStack } from "@chakra-ui/react";
import { useState } from "react";
import { api } from "~/utils/api";
import { BackupCodesPanel } from "./BackupCodesPanel";
import { TwoFactorSetupPanel } from "./TwoFactorSetupPanel";
import { useTwoFactorSetup } from "./useTwoFactorSetup";

/**
 * The whole setup, start to finish, with no chrome of its own.
 *
 * Rendered inside a dialog on the security settings screen and inline on the
 * enrollment gate, which is the point of it having no chrome: the gate is a
 * page somebody has been sent to, and a dialog on top of a page they did not
 * choose to open would be a second thing to dismiss.
 */
export function TwoFactorSetupFlow({
  onFinished,
  onCancel,
}: {
  onFinished: () => void;
  onCancel: () => void;
}) {
  const setup = useTwoFactorSetup({ onFinished });
  const [password, setPassword] = useState("");
  // Whether this account HAS a password to confirm with. Assumed true until
  // the answer lands, so a password field never appears late under somebody
  // who has already started reading.
  const passwordStatus = api.user.hasPassword.useQuery({});
  const holdsPassword = passwordStatus.data?.hasPassword ?? true;

  if (setup.step === "codes") {
    return <BackupCodesPanel codes={setup.backupCodes} onDone={setup.finish} />;
  }

  if (setup.step === "scan" && setup.setupUri) {
    return (
      <TwoFactorSetupPanel
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
        Two-step verification asks for a code from your phone as well as
        whatever you sign in with, so somebody who has learned your password
        still cannot sign in as you.
      </Text>

      {/* Asked for only where there is one to confirm. An account that signs
          in with a passkey has no password to type, and asking anyway made
          this whole flow unusable for exactly the accounts we most want
          enrolled — the server waives the check for the same accounts, so the
          two agree rather than one guessing about the other. */}
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
        <Button
          variant="outline"
          onClick={onCancel}
          disabled={setup.isStarting}
        >
          Cancel
        </Button>
        <Button
          colorPalette="orange"
          loading={setup.isStarting}
          disabled={holdsPassword && password.length === 0}
          onClick={() => void setup.start(holdsPassword ? password : undefined)}
          data-testid="start-two-factor"
        >
          Continue
        </Button>
      </HStack>
    </VStack>
  );
}
