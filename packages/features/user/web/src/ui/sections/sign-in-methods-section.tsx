/**
 * Per-user sign-in methods.
 *
 * Moved from `platform/app/src/components/me/SignInMethodsSection.tsx`, whose
 * shape and copy travel unchanged. Two practical shapes cover almost every
 * account:
 *
 *   - Email/password (better-auth credentials, or Auth0 username-password):
 *     just a Change Password button.
 *   - One SSO/OAuth method (Google / GitHub / Microsoft via Auth0, or
 *     org-enforced single sign-on): the method is shown with no link or unlink
 *     affordance, because enforced single sign-on may not be routed around.
 *
 * The rare case — no single sign-on, several linked providers, ad-hoc linking —
 * still works and is deliberately not the primary surface.
 *
 * NOTHING ON THIS SECTION IS A CREDENTIAL. `getLinkedAccounts` answers the
 * provider and the account id AT the provider; `hasPassword` answers a boolean.
 * The one place a password is typed is the dialog, and it goes one way.
 */

import { Box, Button, HStack, IconButton, Spacer, Spinner, Text, VStack } from "@chakra-ui/react";
import { KeyRound, X } from "lucide-react";
import { useState } from "react";
import { api } from "../../behavior/personal-workspace-api";
import { usePersonalWorkspaceHost } from "../../model/personal-workspace-host";
import {
  canChangePassword,
  isCredentialAccount,
  isRemovableMethod,
  providerDisplayName,
} from "../../model/sign-in-methods";
import { ChangePasswordDialog } from "./change-password-dialog";

export function SignInMethodsSection() {
  const host = usePersonalWorkspaceHost();
  const accounts = api.user.getLinkedAccounts.useQuery({});
  const unlinkAccount = api.user.unlinkAccount.useMutation();
  const publicEnv = api.publicEnv.useQuery(
    {},
    { staleTime: Infinity, refetchOnMount: false, refetchOnWindowFocus: false },
  );
  const utils = api.useUtils();
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);

  // Which of two offers this section makes. Assumed true until the answer
  // arrives: "Change Password" is what almost every account wants, and
  // flickering "Set a password" in front of somebody who has one reads as their
  // password having been lost.
  const passwordStatus = api.user.hasPassword.useQuery({});
  const hasPassword = passwordStatus.data?.hasPassword ?? true;

  const authProvider = publicEnv.data?.NEXTAUTH_PROVIDER;
  const hasSsoProvider = !!host.organization()?.ssoProvider;

  if (!authProvider) {
    return (
      <Text fontSize="sm" color="fg.muted">
        Sign-in management is unavailable in this environment.
      </Text>
    );
  }

  const isEmailMode = authProvider === "email";

  const handleLinkProvider = () => {
    void (async () => {
      const result = await host.linkSignInMethod(authProvider);
      if (!result.ok) {
        host.failed({
          error: new Error(result.reason ?? "link refused"),
          fallbackTitle: "Failed to link sign-in method",
          description: result.reason,
        });
      }
    })();
  };

  const handleUnlink = async (accountId: string) => {
    try {
      await unlinkAccount.mutateAsync({ accountId });
      await utils.user.getLinkedAccounts.invalidate();
      host.succeeded({ title: "Sign-in method removed" });
    } catch (error) {
      host.failed({ error, fallbackTitle: "Couldn't remove the sign-in method" });
    }
  };

  if (isEmailMode) {
    return (
      <HStack width="full">
        <VStack align="start" gap={0}>
          <Text fontSize="sm">{hasPassword ? "Email + password" : "Password"}</Text>
          <Text fontSize="xs" color="fg.muted">
            {hasPassword
              ? "Update the password used to sign in to LangWatch."
              : "You sign in without a password. Set one to get in from a device that does not hold your passkey."}
          </Text>
        </VStack>
        <Spacer />
        <Button
          size="sm"
          colorPalette="orange"
          onClick={() => setChangePasswordOpen(true)}
          data-testid="password-action"
        >
          {hasPassword ? "Change Password" : "Set a password"}
        </Button>
        <ChangePasswordDialog
          open={changePasswordOpen}
          onClose={() => setChangePasswordOpen(false)}
          mode={hasPassword ? "change" : "set"}
        />
      </HStack>
    );
  }

  if (accounts.isLoading) {
    return <Spinner size="sm" />;
  }

  const linked = accounts.data ?? [];

  return (
    <VStack align="stretch" gap={3}>
      {hasSsoProvider && (
        <Text fontSize="xs" color="fg.muted">
          You sign in via your company&apos;s SSO provider. Additional sign-in methods can&apos;t be
          linked.
        </Text>
      )}

      <VStack align="stretch" gap={1}>
        {linked.map((account) => (
          <HStack key={account.id} width="full" gap={2}>
            <KeyRound size={16} />
            <Text fontSize="sm">
              {providerDisplayName(account.provider, account.providerAccountId)}
            </Text>
            <Spacer />
            {isCredentialAccount(account) && canChangePassword(authProvider) && (
              <Button
                size="xs"
                variant="ghost"
                colorPalette="orange"
                onClick={() => setChangePasswordOpen(true)}
              >
                Change Password
              </Button>
            )}
            {isRemovableMethod({ linkedCount: linked.length, hasSsoProvider }) && (
              <IconButton
                aria-label="Remove sign-in method"
                variant="ghost"
                size="xs"
                onClick={() => void handleUnlink(account.id)}
                disabled={unlinkAccount.isPending}
              >
                <X size={16} />
              </IconButton>
            )}
          </HStack>
        ))}
      </VStack>

      {!hasSsoProvider && (
        <Box>
          <Button size="sm" variant="outline" onClick={handleLinkProvider}>
            Link another sign-in method
          </Button>
        </Box>
      )}

      {canChangePassword(authProvider) && (
        <ChangePasswordDialog
          open={changePasswordOpen}
          onClose={() => setChangePasswordOpen(false)}
        />
      )}
    </VStack>
  );
}
