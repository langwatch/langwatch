/**
 * The password this account signs in with, on the screens that ask for one.
 * Its own section since the security-page split. `passwordOfferFor`
 * decides whether this deployment lets the product touch a password at all.
 */

import { Box, Button, HStack, Spacer, Text, VStack } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import type { AccountIdentifier } from "@langwatch/identity-contract";
import { KeyRound } from "lucide-react";
import { useState } from "react";

import { api } from "../../behavior/personal-workspace-api.ts";
import {
  useSignInMethodRemoval,
  type SignInMethodRemovalTarget,
} from "../../behavior/use-sign-in-method-removal.ts";
import { refusalCopy } from "../../features/account-identifiers/model/refusal-copy.ts";
import { usePersonalWorkspaceHost } from "../../model/personal-workspace-host.ts";
import { isCredentialAccount, passwordOfferFor } from "../../model/sign-in-methods.ts";
import { ChangePasswordDialog } from "./change-password-dialog.tsx";
import { RemoveSignInMethodDialog } from "./remove-sign-in-method-dialog.tsx";

/**
 * Remove, stood down before the click where the detach guard would refuse, with
 * the registry's words for that code. The wrapper is the tooltip trigger because
 * a disabled button receives no pointer events.
 */
function RemovePasswordButton({
  verdict,
  accountId,
  isPending,
  onAsk,
}: {
  verdict: AccountIdentifier;
  accountId: string;
  isPending: boolean;
  onAsk: (target: SignInMethodRemovalTarget) => void;
}) {
  const button = (
    <Button
      size="sm"
      variant="ghost"
      colorPalette="red"
      disabled={!verdict.removable || isPending}
      onClick={() =>
        onAsk({ accountId, name: "your password", demotesFirst: verdict.demotesFirst })
      }
      data-testid="remove-password"
    >
      Remove password
    </Button>
  );
  if (verdict.removable || !verdict.refusalCode) return button;

  return (
    <Tooltip content={refusalCopy(verdict.refusalCode)} showArrow>
      <Box data-testid="remove-password-blocked">{button}</Box>
    </Tooltip>
  );
}

export function PasswordSection() {
  const host = usePersonalWorkspaceHost();
  const deployment = host.deployment();
  const passwordStatus = api.user.hasPassword.useQuery({});
  const accounts = api.user.getLinkedAccounts.useQuery({});
  const removal = useSignInMethodRemoval({
    successTitle: "Password removed",
    failureTitle: "Couldn't remove your password",
  });
  const [dialogOpen, setDialogOpen] = useState(false);

  const offer = passwordOfferFor({
    authProvider: deployment.authProvider,
    emailPasswordEnabled: deployment.emailPasswordEnabled ?? false,
    holdsCredentialAccount: (accounts.data ?? []).some(isCredentialAccount),
    hasPasswordAnswer: passwordStatus.data?.hasPassword,
  });
  if (!offer) return null;
  const hasPassword = offer.held;
  const passwordAccount = (accounts.data ?? []).find(isCredentialAccount);
  const verdict = passwordAccount ? removal.verdictFor(passwordAccount.id) : null;

  return (
    <VStack align="start" gap={4} width="full" data-testid="password-section">
      <VStack align="start" gap={1}>
        <HStack gap={2}>
          <KeyRound size={18} />
          <Text fontWeight={600}>Password</Text>
        </HStack>
        <Text color="fg.muted" fontSize="sm">
          {hasPassword
            ? "The password this account signs in with, on the screens that ask for one."
            : "You sign in without one. Setting a password gives you a second way in, for a device your passkey provider does not reach."}
        </Text>
      </VStack>

      <HStack width="full">
        <Spacer />
        {hasPassword && passwordAccount && verdict ? (
          <RemovePasswordButton
            verdict={verdict}
            accountId={passwordAccount.id}
            isPending={removal.isRemoving}
            onAsk={removal.ask}
          />
        ) : null}
        <Button
          size="sm"
          colorPalette="orange"
          onClick={() => setDialogOpen(true)}
          data-testid="password-action"
        >
          {hasPassword ? "Change Password" : "Set a password"}
        </Button>
      </HStack>

      <ChangePasswordDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        mode={hasPassword ? "change" : "set"}
      />

      <RemoveSignInMethodDialog
        target={removal.target}
        staysBehind={removal.staysBehind}
        isRemoving={removal.isRemoving}
        onClose={removal.cancel}
        onConfirm={removal.confirm}
      />
    </VStack>
  );
}
