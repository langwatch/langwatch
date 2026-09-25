/**
 * Asking for a fresh set of backup codes. The old ones stop working the moment
 * the new ones are issued, and the dialog says so: a printed list is now waste paper.
 */
import { Button, Field, HStack, Input, Text, VStack } from "@chakra-ui/react";
import { Dialog } from "@langwatch/design-system/dialog";
import { useState } from "react";

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

  const close = () => {
    setPassword("");
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
            Get new backup codes
          </Dialog.Title>
        </Dialog.Header>
        <Dialog.Body paddingBottom={6}>
          <VStack align="stretch" gap={4}>
            <Text fontSize="sm">
              Your current backup codes stop working straight away, including any you have written
              down or printed.
            </Text>
            {holdsPassword ? (
              <Field.Root>
                <Field.Label>Confirm your password</Field.Label>
                <Input
                  type="password"
                  value={password}
                  autoComplete="current-password"
                  onChange={(event) => setPassword(event.target.value)}
                  data-testid="regenerate-password"
                />
              </Field.Root>
            ) : null}
            <HStack gap={3} justify="end">
              <Button variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button
                colorPalette="orange"
                loading={isGenerating}
                disabled={holdsPassword && password.length === 0}
                onClick={() => {
                  onConfirm(holdsPassword ? password : void 0);
                  setPassword("");
                }}
                data-testid="confirm-regenerate-backup-codes"
              >
                Get new codes
              </Button>
            </HStack>
          </VStack>
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  );
}
