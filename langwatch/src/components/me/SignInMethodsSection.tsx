import {
  Box,
  Button,
  HStack,
  IconButton,
  Spacer,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useState } from "react";
import { LuKeyRound, LuX } from "react-icons/lu";

import { ChangePasswordDialog } from "~/components/settings/ChangePasswordDialog";
import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { api } from "~/utils/api";
import { linkAccount } from "~/utils/auth-client";
import { titleCase } from "~/utils/stringCasing";

const getProviderDisplayName = (
  provider: string,
  providerAccountId: string,
) => {
  if (provider === "auth0") {
    const [actualProvider] = providerAccountId.split("|");

    const providerMap: Record<string, string> = {
      auth0: "Email/Password",
      "google-oauth2": "Google",
      windowslive: "Microsoft",
      github: "GitHub",
    };

    return (
      providerMap[actualProvider ?? ""] ??
      titleCase(actualProvider ?? "unknown")
    );
  }
  return titleCase(provider);
};

const isCredentialAccount = (account: {
  provider: string;
  providerAccountId: string;
}) => {
  if (account.provider === "credential") return true;
  if (account.provider === "auth0") {
    const [strategy] = account.providerAccountId.split("|");
    return strategy === "auth0";
  }
  return false;
};

/**
 * Per-user sign-in methods section, embedded in /me/configure.
 *
 * Two practical shapes for ~100% of users:
 *   - Email/password (BetterAuth credentials, or Auth0 username-password):
 *     just a Change Password button.
 *   - Single SSO/OAuth method (Google / GitHub / Microsoft via Auth0,
 *     or org-enforced SSO): show the method, no link/unlink affordances —
 *     org-enforced SSO disables linking additional methods.
 *
 * Rare case (no SSO + multiple linked OAuth providers + ad-hoc linking)
 * still works but is intentionally not the primary surface.
 */
export function SignInMethodsSection() {
  const { data: accounts, isLoading } = api.user.getLinkedAccounts.useQuery({});
  const unlinkAccount = api.user.unlinkAccount.useMutation();
  const { organization } = useOrganizationTeamProject();
  const publicEnv = usePublicEnv();
  const isAuthProvider = publicEnv.data?.NEXTAUTH_PROVIDER;
  const apiContext = api.useContext();
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);

  const hasSSOProvider = !!organization?.ssoProvider;

  if (!isAuthProvider) {
    return (
      <Text fontSize="sm" color="fg.muted">
        Sign-in management is unavailable in this environment.
      </Text>
    );
  }

  const canChangePassword =
    isAuthProvider === "email" || isAuthProvider === "auth0";
  const isEmailMode = isAuthProvider === "email";

  const handleLinkProvider = () => {
    if (!isAuthProvider) return;
    void (async () => {
      const result = await linkAccount(isAuthProvider, {
        callbackUrl: window.location.href,
      });
      if (result.error) {
        toaster.create({
          title: "Failed to link sign-in method",
          description: result.error,
          type: "error",
          meta: { closable: true },
        });
      }
    })();
  };

  const handleUnlink = async (accountId: string) => {
    try {
      await unlinkAccount.mutateAsync({ accountId });
      await apiContext.user.getLinkedAccounts.invalidate();
      toaster.create({
        title: "Sign-in method removed",
        type: "success",
        meta: { closable: true },
      });
    } catch (error) {
      toaster.create({
        title: "Failed to remove sign-in method",
        description:
          error instanceof Error ? error.message : "Please try again",
        type: "error",
        meta: { closable: true },
      });
    }
  };

  if (isEmailMode) {
    return (
      <HStack width="full">
        <VStack align="start" gap={0}>
          <Text fontSize="sm">Email + password</Text>
          <Text fontSize="xs" color="fg.muted">
            Update the password used to sign in to LangWatch.
          </Text>
        </VStack>
        <Spacer />
        <Button
          size="sm"
          colorPalette="orange"
          onClick={() => setChangePasswordOpen(true)}
        >
          Change Password
        </Button>
        <ChangePasswordDialog
          open={changePasswordOpen}
          onClose={() => setChangePasswordOpen(false)}
        />
      </HStack>
    );
  }

  if (isLoading) {
    return <Spinner size="sm" />;
  }

  const showLinkButton = !hasSSOProvider;

  return (
    <VStack align="stretch" gap={3}>
      {hasSSOProvider && (
        <Text fontSize="xs" color="fg.muted">
          You sign in via your company&apos;s SSO provider. Additional
          sign-in methods can&apos;t be linked.
        </Text>
      )}

      <VStack align="stretch" gap={1}>
        {accounts?.map((account) => {
          const credential = isCredentialAccount(account);
          const removable =
            !hasSSOProvider && (accounts?.length ?? 0) > 1;
          return (
            <HStack key={account.id} width="full" gap={2}>
              <LuKeyRound />
              <Text fontSize="sm">
                {getProviderDisplayName(
                  account.provider,
                  account.providerAccountId,
                )}
              </Text>
              <Spacer />
              {credential && canChangePassword && (
                <Button
                  size="xs"
                  variant="ghost"
                  colorPalette="orange"
                  onClick={() => setChangePasswordOpen(true)}
                >
                  Change Password
                </Button>
              )}
              {removable && (
                <IconButton
                  aria-label="Remove sign-in method"
                  variant="ghost"
                  size="xs"
                  onClick={() => void handleUnlink(account.id)}
                  disabled={unlinkAccount.isLoading}
                >
                  <LuX />
                </IconButton>
              )}
            </HStack>
          );
        })}
      </VStack>

      {showLinkButton && (
        <Box>
          <Button size="sm" variant="outline" onClick={handleLinkProvider}>
            Link another sign-in method
          </Button>
        </Box>
      )}

      {canChangePassword && (
        <ChangePasswordDialog
          open={changePasswordOpen}
          onClose={() => setChangePasswordOpen(false)}
        />
      )}
    </VStack>
  );
}
