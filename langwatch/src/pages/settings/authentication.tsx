import {
  Button,
  Heading,
  HStack,
  IconButton,
  Spacer,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { linkAccount, useSession } from "~/utils/auth-client";
import { useState } from "react";
import { LuKeyRound, LuX } from "react-icons/lu";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { ChangePasswordDialog } from "../../components/settings/ChangePasswordDialog";
import { HorizontalFormControl } from "../../components/HorizontalFormControl";
import SettingsLayout from "../../components/SettingsLayout";
import { toaster } from "../../components/ui/toaster";
import { usePublicEnv } from "../../hooks/usePublicEnv";
import { api } from "../../utils/api";
import { titleCase } from "../../utils/stringCasing";

const getProviderDisplayName = (
  provider: string,
  providerAccountId: string,
) => {
  if (provider === "auth0") {
    // For other auth0 providers, the ID format is "provider|id"
    const [actualProvider] = providerAccountId.split("|");

    const providerMap: Record<string, string> = {
      auth0: "Email/Password",
      "google-oauth2": "Google",
      windowslive: "Microsoft",
      github: "GitHub",
    };

    return (
      (providerMap[actualProvider ?? ""] ??
        titleCase(actualProvider ?? "unknown")) + " (via auth0)"
    );
  }
  return titleCase(provider);
};

/**
 * The user can change their password in-app when their primary identity is
 * a database/credential one — i.e. BetterAuth credentials in email mode, or
 * an `auth0|*` (Username-Password-Authentication) account in Auth0 mode.
 * Social linked identities (Google via Auth0, etc.) don't have a password
 * we can update.
 */
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

export default function AuthenticationSettings() {
  const { data: accounts, isLoading } = api.user.getLinkedAccounts.useQuery({});
  const unlinkAccount = api.user.unlinkAccount.useMutation();
  const { organization } = useOrganizationTeamProject();
  const { data: session } = useSession();
  const publicEnv = usePublicEnv();
  const isAuthProvider = publicEnv.data?.NEXTAUTH_PROVIDER;
  const apiContext = api.useContext();
  const { data: ssoStatus } = api.user.getSsoStatus.useQuery({});
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);

  const hasSSOProvider = !!organization?.ssoProvider;
  const pendingSsoSetup = ssoStatus?.pendingSsoSetup ?? false;

  if (!isAuthProvider) {
    return null;
  }

  // Auth0 mode trusts the authenticated session as proof of identity (modern
  // Auth0 tenants don't expose the Resource Owner Password Grant required to
  // verify the current password server-side). Email/credential mode still
  // requires the current password.
  const requireCurrentPassword = isAuthProvider !== "auth0";
  const canChangePassword =
    isAuthProvider === "email" || isAuthProvider === "auth0";

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
        meta: {
          closable: true,
        },
      });
    } catch (error) {
      toaster.create({
        title: "Failed to remove sign-in method",
        description:
          error instanceof Error ? error.message : "Please try again",
        type: "error",
        meta: {
          closable: true,
        },
      });
    }
  };

  // Email-mode: keep a dedicated section since there's no Linked Sign-in
  // Methods list to hang the link off. It's just a button now — clicking
  // opens the dialog, not an inline form.
  const showEmailModePasswordSection = isAuthProvider === "email";

  return (
    <SettingsLayout>
      <VStack gap={6} width="full" align="start">
        <VStack align="start" gap={1}>
          <Heading as="h2">Authentication Settings</Heading>
          <Text>({session?.user?.email})</Text>
        </VStack>

        {showEmailModePasswordSection && (
          <HorizontalFormControl
            label="Change Password"
            helper={
              <Text>
                Update the password used to sign in to LangWatch.
              </Text>
            }
          >
            <HStack width="full" justify="end" marginTop={4}>
              <Button
                colorPalette="orange"
                onClick={() => setChangePasswordOpen(true)}
              >
                Change Password
              </Button>
            </HStack>
          </HorizontalFormControl>
        )}

        {publicEnv.data?.NEXTAUTH_PROVIDER &&
          publicEnv.data?.NEXTAUTH_PROVIDER !== "email" && (
            <HorizontalFormControl
              label="Linked Sign-in Methods"
              helper={
                !hasSSOProvider ? (
                  <Text>
                    You can link additional sign-in methods to your account.
                    <br />
                    All linked methods must use the same email address as your
                    main account.
                  </Text>
                ) : (
                  <Text>
                    You are linked via your company&apos;s SSO provider.
                    <br />
                    No additional sign-in methods can be linked.
                  </Text>
                )
              }
            >
              {isLoading ? (
                <Spinner />
              ) : (
                <VStack width="full" align="end" gap={6} marginTop={4}>
                  <VStack align="stretch" gap={1} width="full">
                    {accounts?.map((account) => {
                      const credential = isCredentialAccount(account);
                      return (
                        <HStack key={account.id} width="full">
                          <LuKeyRound />
                          <Text>
                            {getProviderDisplayName(
                              account.provider,
                              account.providerAccountId,
                            )}
                          </Text>
                          <Spacer />
                          {credential && canChangePassword && (
                            <Button
                              size="sm"
                              variant="ghost"
                              colorPalette="orange"
                              onClick={() => setChangePasswordOpen(true)}
                            >
                              Change Password
                            </Button>
                          )}
                          {accounts.length > 1 && (
                            <IconButton
                              aria-label="Remove sign-in method"
                              variant="ghost"
                              size="sm"
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
                  <Button
                    onClick={handleLinkProvider}
                    colorPalette="orange"
                    disabled={hasSSOProvider && !pendingSsoSetup}
                  >
                    {pendingSsoSetup
                      ? "Link SSO Sign-in Method"
                      : "Link New Sign-in Method"}
                  </Button>
                </VStack>
              )}
            </HorizontalFormControl>
          )}
      </VStack>

      {canChangePassword && (
        <ChangePasswordDialog
          open={changePasswordOpen}
          onClose={() => setChangePasswordOpen(false)}
          requireCurrentPassword={requireCurrentPassword}
        />
      )}
    </SettingsLayout>
  );
}
