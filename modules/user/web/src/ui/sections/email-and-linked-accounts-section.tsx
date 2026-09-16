/**
 * The address this account is known by, and the identity providers it links.
 * No separate address list to add or confirm yet - see the handoff.
 */

import { Box, Button, HStack, IconButton, Spacer, Spinner, Text, VStack } from "@chakra-ui/react";
import { AtSign, KeyRound, X } from "lucide-react";
import { api } from "../../behavior/personal-workspace-api.ts";
import { usePersonalWorkspaceHost } from "../../model/personal-workspace-host.ts";
import { isRemovableMethod, providerDisplayName } from "../../model/sign-in-methods.ts";

export function EmailAndLinkedAccountsSection() {
  const host = usePersonalWorkspaceHost();
  const accounts = api.user.getLinkedAccounts.useQuery({});
  const unlinkAccount = api.user.unlinkAccount.useMutation();
  const utils = api.useUtils();

  const email = host.currentUser()?.email;
  const authProvider = host.deployment().authProvider;
  const hasSsoProvider = !!host.organization()?.ssoProvider;

  const handleUnlink = async (accountId: string) => {
    try {
      await unlinkAccount.mutateAsync({ accountId });
      await utils.user.getLinkedAccounts.invalidate();
      host.succeeded({ title: "Sign-in method removed" });
    } catch (error) {
      host.failed({ error, fallbackTitle: "Couldn't remove the sign-in method" });
    }
  };

  if (!authProvider) {
    return (
      <VStack align="start" gap={1} width="full" data-testid="email-and-linked-accounts-section">
        <Text fontWeight={600}>Email address &amp; linked accounts</Text>
        <Text fontSize="sm" color="fg.muted">
          Sign-in management is unavailable in this environment.
        </Text>
      </VStack>
    );
  }

  const linked = accounts.data ?? [];
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

  return (
    <VStack align="start" gap={4} width="full" data-testid="email-and-linked-accounts-section">
      <VStack align="start" gap={1}>
        <HStack gap={2}>
          <AtSign size={18} />
          <Text fontWeight={600}>Email address &amp; linked accounts</Text>
        </HStack>
        <Text color="fg.muted" fontSize="sm">
          The address this account is known by, and the identity providers that vouch for it.
        </Text>
      </VStack>

      {email && (
        <HStack width="full" gap={2}>
          <AtSign size={16} />
          <Text fontSize="sm">{email}</Text>
        </HStack>
      )}

      {hasSsoProvider && (
        <Text fontSize="xs" color="fg.muted">
          You sign in via your company&apos;s SSO provider. Additional sign-in methods can&apos;t be
          linked.
        </Text>
      )}

      {authProvider !== "email" && accounts.isLoading && <Spinner size="sm" />}

      {authProvider !== "email" && !accounts.isLoading && (
        <VStack align="stretch" gap={1} width="full">
          {linked.map((account) => (
            <HStack key={account.id} width="full" gap={2}>
              <KeyRound size={16} />
              <Text fontSize="sm">
                {providerDisplayName(account.provider, account.providerAccountId)}
              </Text>
              <Spacer />
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
      )}

      {authProvider !== "email" && !hasSsoProvider && (
        <Box>
          <Button size="sm" variant="outline" onClick={handleLinkProvider}>
            Link another sign-in method
          </Button>
        </Box>
      )}
    </VStack>
  );
}
