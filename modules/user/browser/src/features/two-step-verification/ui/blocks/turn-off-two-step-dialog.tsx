import { Dialog } from "@langwatch/design-system/dialog";
/** Turning two-step verification off costs the password and a current code. */
import { Field, Input, Text, VStack } from "@langwatch/design-system/primitives";
import { useRef, useState } from "react";

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
  const [attempted, setAttempted] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  const close = () => {
    setPassword("");
    setCode("");
    setAttempted(false);
    onClose();
  };

  const missingPassword = holdsPassword && password.length === 0;
  const missingCode = code.length === 0;

  const submit = () => {
    if (turningOff) return;
    setAttempted(true);
    if (missingPassword) {
      passwordRef.current?.focus();
      return;
    }
    if (missingCode) {
      codeRef.current?.focus();
      return;
    }
    onConfirm({ password, code }, close);
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Turn off two-step verification"
      placement="center"
      onSubmit={submit}
      primaryAction={{
        label: "Turn off",
        type: "submit",
        danger: true,
        loading: turningOff,
        "data-testid": "confirm-turn-off-two-factor",
      }}
    >
      <VStack align="stretch" gap={4}>
        <Text fontSize="sm">
          You will sign in with your password alone from then on. Your backup codes stop working
          too.
        </Text>
        {holdsPassword ? (
          <Field.Root invalid={attempted && missingPassword}>
            <Field.Label>Confirm your password</Field.Label>
            <Input
              ref={passwordRef}
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
              data-testid="turn-off-password"
            />
            <Field.ErrorText>Enter your password.</Field.ErrorText>
          </Field.Root>
        ) : null}
        <Field.Root invalid={attempted && missingCode}>
          <Field.Label>Enter the code from your app</Field.Label>
          <Input
            ref={codeRef}
            value={code}
            inputMode="numeric"
            autoComplete="one-time-code"
            onChange={(event) => setCode(event.target.value.trim())}
            data-testid="turn-off-code"
          />
          <Field.ErrorText>Enter the code from your app.</Field.ErrorText>
        </Field.Root>
      </VStack>
    </Dialog>
  );
}
