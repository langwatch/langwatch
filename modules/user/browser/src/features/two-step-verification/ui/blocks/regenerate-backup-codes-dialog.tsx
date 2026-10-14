import { Dialog } from "@langwatch/design-system/dialog";
/**
 * Asking for a fresh set of backup codes. The old ones stop working the moment
 * the new ones are issued, and the dialog says so: a printed list is now waste paper.
 */
import { Field, Input, Text, VStack } from "@langwatch/design-system/primitives";
import { useRef, useState } from "react";

export function RegenerateBackupCodesDialog({
  open,
  holdsPassword,
  isGenerating,
  onClose,
  onConfirm,
}: {
  open: boolean;
  holdsPassword: boolean;
  isGenerating: boolean;
  onClose: () => void;
  onConfirm: (password?: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [attempted, setAttempted] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  const close = () => {
    setPassword("");
    setAttempted(false);
    onClose();
  };

  const missingPassword = holdsPassword && password.length === 0;

  const submit = () => {
    if (isGenerating) return;
    setAttempted(true);
    if (missingPassword) {
      passwordRef.current?.focus();
      return;
    }
    onConfirm(holdsPassword ? password : void 0);
    setPassword("");
    setAttempted(false);
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Get new backup codes"
      placement="center"
      onSubmit={submit}
      primaryAction={{
        label: "Get new codes",
        type: "submit",
        loading: isGenerating,
        "data-testid": "confirm-regenerate-backup-codes",
      }}
    >
      <VStack align="stretch" gap={4}>
        <Text fontSize="sm">
          Your current backup codes stop working straight away, including any you have written down
          or printed.
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
              data-testid="regenerate-password"
            />
            <Field.ErrorText>Enter your password.</Field.ErrorText>
          </Field.Root>
        ) : null}
      </VStack>
    </Dialog>
  );
}
