import { Dialog } from "@langwatch/design-system/dialog";
import { Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";

import type { SignInMethodRemovalTarget } from "../../behavior/use-sign-in-method-removal.ts";

/**
 * The question before a way in is given up: what stays, and whether another
 * becomes primary first. "Are you sure" is unanswerable without knowing what is left.
 */
export function RemoveSignInMethodDialog({
  target,
  staysBehind,
  isRemoving,
  onClose,
  onConfirm,
}: {
  target: SignInMethodRemovalTarget | null;
  staysBehind: (accountId: string) => string[];
  isRemoving: boolean;
  onClose: () => void;
  onConfirm: (accountId: string) => void;
}) {
  const remaining = target ? staysBehind(target.accountId) : [];

  return (
    <Dialog.Root
      open={target !== null}
      onOpenChange={(details) => {
        if (!details.open) onClose();
      }}
      placement="center"
    >
      <Dialog.Content bg="bg" data-testid="unlink-method-dialog">
        <Dialog.CloseTrigger />
        <Dialog.Header>
          <Dialog.Title fontSize="md" fontWeight="500">
            Remove {target?.name ?? "this sign-in method"}?
          </Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <VStack align="start" gap={3}>
            <Text fontSize="sm" color="fg.muted">
              {remaining.length > 0
                ? `You will still be able to sign in with ${remaining.join(", ")}.`
                : "You will still be able to sign in with the other methods on your account."}
            </Text>
            {target?.demotesFirst ? (
              <Text fontSize="sm" color="fg.muted">
                This is your primary sign-in method, so another confirmed one becomes primary first.
              </Text>
            ) : null}
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <HStack gap={3} justify="end" width="full">
            <Button variant="outline" onClick={onClose} disabled={isRemoving}>
              Cancel
            </Button>
            <Button
              colorPalette="red"
              loading={isRemoving}
              onClick={() => target && onConfirm(target.accountId)}
              data-testid="confirm-unlink-method"
            >
              Remove
            </Button>
          </HStack>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
