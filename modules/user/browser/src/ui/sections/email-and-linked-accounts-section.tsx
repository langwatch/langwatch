/**
 * The addresses this account is known by and the identity providers that vouch for
 * it, as one list under one heading: the detach guard reasons across both.
 * Spec: specs/identity/authentication-settings.feature
 */

import {
  Box,
  Button,
  HStack,
  IconButton,
  Spacer,
  Spinner,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { AtSign, KeyRound, X } from "lucide-react";

import { api } from "../../behavior/personal-workspace-api.ts";
import { useSignInMethodRemoval } from "../../behavior/use-sign-in-method-removal.ts";
import { refusalCopy } from "../../features/account-identifiers/model/refusal-copy.ts";
import { EmailIdentifiersSection } from "../../features/account-identifiers/ui/sections/email-identifiers-section.tsx";
import { usePersonalWorkspaceHost } from "../../model/personal-workspace-host.ts";
import {
  connectableProviders,
  connectLabel,
  providerDisplayName,
} from "../../model/sign-in-methods.ts";
import { RemoveSignInMethodDialog } from "./remove-sign-in-method-dialog.tsx";

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
          <Text fontWeight={600}>Linked Accounts</Text>
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
          federated && !hasSsoProvider ? (
            <ConnectProviderButtons
              offered={host.deployment().federatedProviders ?? [authProvider]}
            />
          ) : null
        }
      />
    </VStack>
  );
}

function UnlinkMethodButton({
  name,
  removable,
  refusalCode,
  isPending,
  onAsk,
}: {
  name: string;
  removable: boolean;
  refusalCode: string | null;
  isPending: boolean;
  onAsk: () => void;
}) {
  const button = (
    <IconButton
      aria-label={`Remove ${name}`}
      variant="ghost"
      size="xs"
      onClick={onAsk}
      disabled={!removable || isPending}
      data-testid="unlink-method"
    >
      <X size={16} />
    </IconButton>
  );
  if (removable || !refusalCode) return button;

  return (
    <Tooltip content={refusalCopy(refusalCode)} showArrow>
      <Box data-testid="unlink-method-blocked">{button}</Box>
    </Tooltip>
  );
}

/**
 * The guard decides whether a row can go, not a count and not the organization's
 * sign-on setting: an enforcing organization may unlink, and the question says it
 * comes back.
 */
function LinkedAccountRows({ hasSsoProvider }: { hasSsoProvider: boolean }) {
  const accounts = api.user.getLinkedAccounts.useQuery({});
  const removal = useSignInMethodRemoval({
    successTitle: "Sign-in method removed",
    failureTitle: "Couldn't remove the sign-in method",
  });

  if (accounts.isLoading) return <Spinner size="sm" />;

  const linked = accounts.data ?? [];
  return (
    <VStack align="stretch" gap={1} width="full">
      {linked.map((account) => {
        const name = providerDisplayName(account.provider, account.providerAccountId);
        const verdict = removal.verdictFor(account.id);
        return (
          <HStack key={account.id} width="full" gap={2} paddingY={2}>
            <KeyRound size={16} />
            <Text fontSize="sm">{name}</Text>
            <Spacer />
            {verdict ? (
              <UnlinkMethodButton
                name={name}
                removable={verdict.removable}
                refusalCode={verdict.refusalCode}
                isPending={removal.isRemoving}
                onAsk={() =>
                  removal.ask({ accountId: account.id, name, demotesFirst: verdict.demotesFirst })
                }
              />
            ) : null}
          </HStack>
        );
      })}
      <RemoveSignInMethodDialog
        target={removal.target}
        staysBehind={removal.staysBehind}
        organizationEnforcesSso={hasSsoProvider}
        isRemoving={removal.isRemoving}
        onClose={removal.cancel}
        onConfirm={removal.confirm}
      />
    </VStack>
  );
}

function ConnectProviderButtons({ offered }: { offered: readonly string[] }) {
  const host = usePersonalWorkspaceHost();
  const accounts = api.user.getLinkedAccounts.useQuery({});
  const hasSsoProvider = !!host.organization()?.ssoProvider;

  if (accounts.isLoading) return null;

  const providers = connectableProviders({
    offered,
    linked: accounts.data ?? [],
    hasSsoProvider,
  });
  const connect = async (provider: string) => {
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
    <HStack gap={3} flexWrap="wrap">
      {providers.map((provider) => (
        <Button
          key={provider}
          size="sm"
          variant="outline"
          onClick={() => void connect(provider)}
          data-testid={`link-method-${provider}`}
        >
          Connect {connectLabel(provider)}
        </Button>
      ))}
    </HStack>
  );
}
