/**
 * The addresses this account is known by and the identity providers that vouch for
 * it, as one list under one heading: the detach guard reasons across both.
 * Spec: specs/identity/authentication-settings.feature
 */

import { Button, HStack, IconButton, Spacer, Spinner, Text, VStack } from "@chakra-ui/react";
import { AtSign, KeyRound, X } from "lucide-react";

import { api } from "../../behavior/personal-workspace-api.ts";
import { EmailIdentifiersSection } from "../../features/account-identifiers/ui/sections/email-identifiers-section.tsx";
import { usePersonalWorkspaceHost } from "../../model/personal-workspace-host.ts";
import { isRemovableMethod, providerDisplayName } from "../../model/sign-in-methods.ts";

export function EmailAndLinkedAccountsSection() {
  const host = usePersonalWorkspaceHost();
  const authProvider = host.deployment().authProvider;
  const federated = authProvider !== void 0 && authProvider !== "email";
  const hasSsoProvider = !!host.organization()?.ssoProvider;

  return (
    <VStack align="start" gap={4} width="full" data-testid="email-and-linked-accounts-section">
      <VStack align="start" gap={1}>
        <HStack gap={2}>
          <AtSign size={18} />
          <Text fontWeight={600}>Linked accounts</Text>
        </HStack>
        <Text color="fg.muted" fontSize="sm">
          The addresses this account is known by, and the identity providers that vouch for it.
        </Text>
      </VStack>

      {hasSsoProvider && (
        <Text fontSize="xs" color="fg.muted">
          You sign in via your company&apos;s SSO provider. Additional sign-in methods can&apos;t be
          linked.
        </Text>
      )}

      <EmailIdentifiersSection
        providerRows={federated ? <LinkedAccountRows hasSsoProvider={hasSsoProvider} /> : null}
        trailingActions={
          federated && !hasSsoProvider ? <LinkProviderButton provider={authProvider} /> : null
        }
      />
    </VStack>
  );
}

function LinkedAccountRows({ hasSsoProvider }: { hasSsoProvider: boolean }) {
  const host = usePersonalWorkspaceHost();
  const accounts = api.user.getLinkedAccounts.useQuery({});
  const unlinkAccount = api.user.unlinkAccount.useMutation();
  const utils = api.useUtils();

  const handleUnlink = async (accountId: string) => {
    try {
      await unlinkAccount.mutateAsync({ accountId });
      await utils.user.getLinkedAccounts.invalidate();
      host.succeeded({ title: "Sign-in method removed" });
    } catch (error) {
      host.failed({ error, fallbackTitle: "Couldn't remove the sign-in method" });
    }
  };

  if (accounts.isLoading) return <Spinner size="sm" />;

  const linked = accounts.data ?? [];
  return (
    <VStack align="stretch" gap={1} width="full">
      {linked.map((account) => (
        <HStack key={account.id} width="full" gap={2} paddingY={2}>
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
  );
}

function LinkProviderButton({ provider }: { provider: string }) {
  const host = usePersonalWorkspaceHost();
  const handleLinkProvider = async () => {
    const result = await host.linkSignInMethod(provider);
    if (!result.ok) {
      host.failed({
        error: new Error(result.reason ?? "link refused"),
        fallbackTitle: "Failed to link sign-in method",
        description: result.reason,
      });
    }
  };
  return (
    <Button size="sm" variant="outline" onClick={() => void handleLinkProvider()}>
      Link another sign-in method
    </Button>
  );
}
