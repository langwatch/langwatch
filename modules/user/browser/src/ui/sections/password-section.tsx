/**
 * The password this account signs in with, on the screens that ask for one.
 * Its own section since the security-page split. `passwordOfferFor`
 * decides whether this deployment lets the product touch a password at all.
 */

import { Button, HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import { KeyRound } from "lucide-react";
import { useState } from "react";

import { api } from "../../behavior/personal-workspace-api.ts";
import { usePersonalWorkspaceHost } from "../../model/personal-workspace-host.ts";
import { isCredentialAccount, passwordOfferFor } from "../../model/sign-in-methods.ts";
import { ChangePasswordDialog } from "./change-password-dialog.tsx";

export function PasswordSection() {
  const host = usePersonalWorkspaceHost();
  const deployment = host.deployment();
  const passwordStatus = api.user.hasPassword.useQuery({});
  const accounts = api.user.getLinkedAccounts.useQuery({});
  const [dialogOpen, setDialogOpen] = useState(false);

  const offer = passwordOfferFor({
    authProvider: deployment.authProvider,
    emailPasswordEnabled: deployment.emailPasswordEnabled ?? false,
    holdsCredentialAccount: (accounts.data ?? []).some(isCredentialAccount),
    hasPasswordAnswer: passwordStatus.data?.hasPassword,
  });
  if (!offer) return null;
  const hasPassword = offer.held;

  return (
    <VStack align="start" gap={4} width="full" data-testid="password-section">
      <VStack align="start" gap={1}>
        <HStack gap={2}>
          <KeyRound size={18} />
          <Text fontWeight={600}>Password</Text>
        </HStack>
        <Text color="fg.muted" fontSize="sm">
          {hasPassword
            ? "Used on the screens that ask for one."
            : "You sign in without one. Setting a password gives you a second way in, for a device your passkey provider does not reach."}
        </Text>
      </VStack>

      <HStack width="full">
        <Spacer />
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
    </VStack>
  );
}
