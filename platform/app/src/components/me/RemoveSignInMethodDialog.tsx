import { Button, HStack, Text, VStack } from "@chakra-ui/react";

import { Dialog } from "~/components/ui/dialog";
import type { SignInMethodRemovalTarget } from "./useSignInMethodRemoval";

/**
 * The question before a way in is given up, and the three things it has to
 * answer.
 *
 * What stays — because "are you sure" is not a question anybody can answer
 * without knowing what is left. Whether it comes back — a member of an
 * organization that federates is re-linked by their next single sign-on, so
 * this is allowed rather than blocked, and saying so is what stops it reading
 * as a mistake. And whether something else becomes primary first, because that
 * is a change to the account they did not ask for and would otherwise discover
 * later.
 */
export function RemoveSignInMethodDialog({
  target,
  staysBehind,
  organizationEnforcesSso,
  isRemoving,
  onClose,
  onConfirm,
}: {
  target: SignInMethodRemovalTarget | null;
  staysBehind: (accountId: string) => string[];
  /** Only the linked accounts can come back on the next sign-in; a password
   *  never does, so its section passes false. */
  organizationEnforcesSso: boolean;
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
                This is your primary sign-in method, so another confirmed one
                becomes primary first.
              </Text>
            ) : null}
            {organizationEnforcesSso ? (
              <Text
                fontSize="sm"
                color="fg.muted"
                data-testid="unlink-relinks-on-sso"
              >
                Your organization signs people in through single sign-on, so the
                next time you sign in that way it will be linked again.
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
