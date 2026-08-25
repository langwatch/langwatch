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
import type { SignInMethod } from "@langwatch/identity";
import { LuX } from "react-icons/lu";

import { SETTINGS_ACTION_BUTTON_WIDTH } from "~/components/settings/actionRow";
import { SectionErrorNotice } from "~/components/settings/SectionErrorNotice";
import { SettingsSectionRow } from "~/components/settings/SettingsSection";
import { toaster } from "~/components/ui/toaster";
import { Tooltip } from "~/components/ui/tooltip";
import { refusalCopy } from "~/features/account-identifiers/logic/refusalCopy";
import { SignInMethodIcon } from "~/features/auth/components/SignInMethodIcon";
import { signInMethodLabel } from "~/features/auth/logic/methodLabels";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import type { AccountIdentifier } from "~/server/app-layer/identity/account-identifiers.service";
import { api } from "~/utils/api";
import { linkAccount } from "~/utils/auth-client";
import { RemoveSignInMethodDialog } from "./RemoveSignInMethodDialog";
import {
  isCredentialAccount,
  type LinkedAccount,
  linkedAccountMethodId,
} from "./signInAccounts";
import {
  type SignInMethodRemovalTarget,
  useSignInMethodRemoval,
} from "./useSignInMethodRemoval";

/**
 * A development stack rarely has social credentials mounted, so it offers none
 * of them — which would hide the whole surface from exactly the people
 * iterating on it. In dev the section offers the cloud's full social set,
 * wired to the real linking call; everywhere else it offers what the
 * deployment actually mounted. The same gate the auth screens' method picker
 * uses, for the same reason.
 */
const DEV_SHOWS_ALL_SOCIAL = import.meta.env.DEV;

/** The cloud's social set. Ids are the real provider ids, so a click dials the
 *  real provider and the marks and labels are the real ones. */
const SOCIAL_PROVIDER_IDS: readonly string[] = ["google", "github", "azure-ad"];

const asMethod = (id: string): SignInMethod => ({
  id,
  kind: "federated",
  connectionId: null,
});

/**
 * Unlink, with the guard's reason where it is not offered.
 *
 * A disabled control that says nothing is the worst version of this: somebody
 * can see the thing they want and is told nothing about why they cannot have
 * it. The words are the registry's, keyed by the code the route would refuse
 * with, so the screen and the refusal cannot say different things.
 */
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
      <LuX />
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
 * One connected provider, and the one thing that can be done to it.
 *
 * The name and the mark come from the auth screens' own two tables, so a row
 * here reads as the button somebody clicked to get in.
 */
function LinkedAccountRow({
  account,
  verdict,
  isRemoving,
  onAsk,
}: {
  account: LinkedAccount;
  /** What the detach guard would say, or nothing where no identifier mirrors
   *  this row yet. */
  verdict: AccountIdentifier | null;
  isRemoving: boolean;
  onAsk: (target: SignInMethodRemovalTarget) => void;
}) {
  const method = asMethod(linkedAccountMethodId(account));
  const name = signInMethodLabel(method);

  return (
    <SettingsSectionRow testId="linked-account-row">
      <Box color="fg.muted" display="flex">
        <SignInMethodIcon method={method} />
      </Box>
      <Text fontSize="sm" fontWeight={500}>
        {name}
      </Text>
      <Spacer />
      {verdict ? (
        <UnlinkMethodButton
          name={name}
          // The guard decides, not the count of rows and not the
          // organization's single sign-on setting.
          removable={verdict.removable}
          refusalCode={verdict.refusalCode}
          isPending={isRemoving}
          onAsk={() =>
            onAsk({
              accountId: account.id,
              name,
              demotesFirst: verdict.demotesFirst,
            })
          }
        />
      ) : null}
    </SettingsSectionRow>
  );
}

/**
 * The providers this deployment can still link: what it mounted, plus the
 * cloud's social set in development, less whatever is already connected — a
 * row for a provider is the answer to "can I use this one".
 *
 * An organization that enforces single sign-on can link nothing, which is the
 * deployment's rule rather than this screen's.
 */
function connectableProviders({
  configuredProvider,
  linkedMethodIds,
  organizationEnforcesSso,
}: {
  configuredProvider: string;
  linkedMethodIds: ReadonlySet<string>;
  organizationEnforcesSso: boolean;
}): string[] {
  if (organizationEnforcesSso) return [];

  const offered = [
    ...(configuredProvider === "email" ? [] : [configuredProvider]),
    ...(DEV_SHOWS_ALL_SOCIAL ? SOCIAL_PROVIDER_IDS : []),
  ];
  return Array.from(new Set(offered)).filter((id) => !linkedMethodIds.has(id));
}

/**
 * The offer to connect one, as the provider's own mark and name.
 *
 * A button per provider rather than one "link another sign-in method": the
 * mark is what somebody is looking for, and a single neutral button asks them
 * to find out what it does by pressing it.
 */
export function ConnectProviderButtons({ providers }: { providers: string[] }) {
  if (providers.length === 0) return null;

  return (
    <HStack gap={3} flexWrap="wrap">
      {providers.map((providerId) => (
        <Button
          key={providerId}
          size="sm"
          variant="outline"
          width={SETTINGS_ACTION_BUTTON_WIDTH}
          justifyContent="center"
          onClick={() => connectProvider(providerId)}
          data-testid={`link-method-${providerId}`}
        >
          <SignInMethodIcon method={asMethod(providerId)} />
          Connect {signInMethodLabel(asMethod(providerId))}
        </Button>
      ))}
    </HStack>
  );
}

/** Starting the link, and saying so when the provider would not have it. */
function connectProvider(providerId: string) {
  void (async () => {
    const result = await linkAccount(providerId, {
      callbackUrl: window.location.href,
    });
    if (result.error) {
      toaster.create({
        title: "Failed to link sign-in method",
        description: result.error,
        type: "error",
      });
    }
  })();
}

/**
 * Which providers this deployment could still connect, for the band's one
 * action row. A hook so the row lives beside "Add an email address" while the
 * rules stay here, with the rows they are about.
 */
export function useConnectableProviders(): string[] {
  const { data: accounts } = api.user.getLinkedAccounts.useQuery({});
  const { organization } = useOrganizationTeamProject();
  const publicEnv = usePublicEnv();

  const configuredProvider = publicEnv.data?.NEXTAUTH_PROVIDER;
  if (!configuredProvider) return [];

  const linked = (accounts ?? []).filter(
    (account) => !isCredentialAccount(account),
  );
  return connectableProviders({
    configuredProvider,
    linkedMethodIds: new Set(linked.map(linkedAccountMethodId)),
    organizationEnforcesSso: !!organization?.ssoProvider,
  });
}

/**
 * The identity providers this account signs in through, as rows in the
 * identifiers band — beneath the addresses, in the same list, because that is
 * what they are to the model and to the guard that reasons across both.
 *
 * The LIST never waits on the removal verdicts. Which providers are connected
 * is the account read's answer and nothing else's; only whether each one can
 * be given up needs the guard, so only that degrades when the guard cannot be
 * reached — the rows stay, and the alert says what is missing.
 *
 * An organization that enforces single sign-on gets no connect buttons, which
 * is the deployment's rule rather than this screen's. Disconnecting is still
 * offered there: signing in that way links it again, and the confirmation says
 * so, so nothing is lost that does not come back.
 *
 * Spec: specs/identity/authentication-settings.feature
 */
export function LinkedAccountRows() {
  const { data: accounts, isLoading } = api.user.getLinkedAccounts.useQuery({});
  const { organization } = useOrganizationTeamProject();
  const publicEnv = usePublicEnv();
  const removal = useSignInMethodRemoval({
    successTitle: "Sign-in method removed",
    failureTitle: "Couldn't remove the sign-in method",
  });

  const configuredProvider = publicEnv.data?.NEXTAUTH_PROVIDER;
  const hasSSOProvider = !!organization?.ssoProvider;

  if (!configuredProvider) {
    return (
      <Text fontSize="sm" color="fg.muted">
        Sign-in management is unavailable in this environment.
      </Text>
    );
  }

  const linked = (accounts ?? []).filter(
    (account) => !isCredentialAccount(account),
  );

  return (
    <VStack
      width="full"
      align="stretch"
      gap={2}
      data-testid="linked-accounts-section"
    >
      {hasSSOProvider ? (
        <Text fontSize="sm" color="fg.muted">
          You sign in through your company&apos;s single sign-on provider. Other
          sign-in methods cannot be connected.
        </Text>
      ) : null}

      {isLoading ? <Spinner size="sm" /> : null}

      {linked.map((account) => (
        <LinkedAccountRow
          key={account.id}
          account={account}
          verdict={removal.verdictFor(account.id)}
          isRemoving={removal.isRemoving}
          onAsk={removal.ask}
        />
      ))}

      {/* Only where there is something whose removability we failed to judge.
          An alert about rows that do not exist is an apology for nothing. */}
      {linked.length > 0 ? (
        <SectionErrorNotice
          error={removal.verdictsError}
          fallbackTitle="Couldn't check which linked accounts can be removed"
        />
      ) : null}

      <RemoveSignInMethodDialog
        target={removal.target}
        staysBehind={removal.staysBehind}
        organizationEnforcesSso={hasSSOProvider}
        isRemoving={removal.isRemoving}
        onClose={removal.cancel}
        onConfirm={removal.confirm}
      />
    </VStack>
  );
}
