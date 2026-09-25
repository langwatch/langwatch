/** Turning two-step verification off costs the password and a current code. */
import { Button, Field, HStack, Input, Text, VStack } from "@chakra-ui/react";
import { Dialog } from "@langwatch/design-system/dialog";
import { useState } from "react";

export function TurnOffTwoStepDialog({
  open,
  holdsPassword,
  turningOff,
  onClose,
  onConfirm,
}: {
  open: boolean;
  holdsPassword: boolean;
  turningOff: boolean;
  onClose: () => void;
  onConfirm: (input: { password: string; code: string }, onTurnedOff: () => void) => void;
}) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");

  const close = () => {
    setPassword("");
    setCode("");
    onClose();
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(details) => {
        if (!details.open) close();
      }}
      placement="center"
    >
      <Dialog.Content bg="bg">
        <Dialog.CloseTrigger />
        <Dialog.Header>
          <Dialog.Title fontSize="md" fontWeight="500">
            Turn off two-step verification
          </Dialog.Title>
        </Dialog.Header>
        <Dialog.Body paddingBottom={6}>
          <VStack align="stretch" gap={4}>
            <Text fontSize="sm">
              You will sign in with your password alone from then on. Your backup codes stop working
              too.
            </Text>
            {holdsPassword ? (
              <Field.Root>
                <Field.Label>Confirm your password</Field.Label>
                <Input
                  type="password"
                  value={password}
                  autoComplete="current-password"
                  onChange={(event) => setPassword(event.target.value)}
                  data-testid="turn-off-password"
                />
              </Field.Root>
            ) : null}
            <Field.Root>
              <Field.Label>Enter the code from your app</Field.Label>
              <Input
                value={code}
                inputMode="numeric"
                autoComplete="one-time-code"
                onChange={(event) => setCode(event.target.value.trim())}
                data-testid="turn-off-code"
              />
            </Field.Root>
            <HStack gap={3} justify="end">
              <Button variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button
                colorPalette="red"
                loading={turningOff}
                disabled={(holdsPassword && password.length === 0) || code.length === 0}
                onClick={() => onConfirm({ password, code }, close)}
                data-testid="confirm-turn-off-two-factor"
              >
                Turn off
              </Button>
            </HStack>
          </VStack>
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  );
}
