import { Dialog } from "@langwatch/design-system/dialog";
import { Text, VStack } from "@langwatch/design-system/primitives";

import type { SignInMethodRemovalTarget } from "../../behavior/use-sign-in-method-removal.ts";

/**
 * The question before a way in is given up: what stays, whether another
 * becomes primary first, and whether single sign-on brings it back. "Are you sure"
 * is unanswerable without knowing what is left.
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
  /** Only a linked account comes back on the next sign-in; a password never does. */
  organizationEnforcesSso: boolean;
  isRemoving: boolean;
  onClose: () => void;
  onConfirm: (accountId: string) => void;
}) {
  const remaining = target ? staysBehind(target.accountId) : [];

  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      title={`Remove ${target?.name ?? "this sign-in method"}?`}
      placement="center"
      busy={isRemoving}
      data-testid="unlink-method-dialog"
      primaryAction={{
        label: "Remove",
        danger: true,
        loading: isRemoving,
        onClick: () => {
          if (target) onConfirm(target.accountId);
        },
        "data-testid": "confirm-unlink-method",
      }}
    >
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
        {organizationEnforcesSso ? (
          <Text fontSize="sm" color="fg.muted" data-testid="unlink-relinks-on-sso">
            Your organization signs people in through single sign-on, so the next time you sign in
            that way it will be linked again.
          </Text>
        ) : null}
      </VStack>
    </Dialog>
  );
}
