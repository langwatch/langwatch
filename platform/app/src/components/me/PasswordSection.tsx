import { Box, Button, HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import { KeyRound } from "lucide-react";
import { useState } from "react";

import { ChangePasswordDialog } from "~/components/settings/ChangePasswordDialog";
import { SettingsRowsSkeleton } from "~/components/settings/kit/SettingsSkeleton";
import { SectionErrorNotice } from "~/components/settings/SectionErrorNotice";
import { SettingsEmptyState } from "~/components/settings/SettingsEmptyState";
import {
  SettingsSection,
  SettingsSectionRow,
} from "~/components/settings/SettingsSection";
import { Tooltip } from "~/components/ui/tooltip";
import { refusalCopy } from "~/features/account-identifiers/logic/refusalCopy";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import type { AccountIdentifier } from "~/server/app-layer/identity/account-identifiers.service";
import { api } from "~/utils/api";
import { RemoveSignInMethodDialog } from "./RemoveSignInMethodDialog";
import { isCredentialAccount, type LinkedAccount } from "./signInAccounts";
import {
  type SignInMethodRemovalTarget,
  useSignInMethodRemoval,
} from "./useSignInMethodRemoval";

/** The anchor the summary beside the page scrolls to. */
export const PASSWORD_ANCHOR = "password";

/** What this deployment and this account make of a password. */
interface PasswordOffer {
  /** Whether there is one to change, or none yet to set. */
  held: boolean;
  /** The row a removal would detach, where one exists. */
  account: LinkedAccount | null;
}

/**
 * Which offer this section makes, or none at all.
 *
 * Two deployments hold a password, and they hold it in different places. On a
 * credentials deployment it is ours, so an account can have none and setting a
 * first one is a real offer. On an Auth0 deployment it is Auth0's, and only an
 * account with a database identity there has one — for somebody who has only
 * ever clicked Google there is nothing here to set, and offering it would be
 * an offer we cannot honour. Anywhere else authenticates people entirely
 * elsewhere, and this section would be about nothing.
 */
function passwordOffer({
  provider,
  accounts,
  hasPasswordAnswer,
}: {
  provider: string | undefined;
  accounts: readonly LinkedAccount[];
  hasPasswordAnswer: boolean | undefined;
}): PasswordOffer | null {
  const account = accounts.find(isCredentialAccount) ?? null;
  if (provider === "email") {
    // Assumed held until the answer arrives: "Change password" is what almost
    // every account wants, and flickering "Set a password" in front of
    // somebody who has one reads as their password having been lost.
    return { held: hasPasswordAnswer ?? true, account };
  }
  if (provider === "auth0" && account) return { held: true, account };
  return null;
}

/**
 * Remove, and the guard's reason where it is not offered.
 *
 * A disabled control that says nothing is the worst version of this: somebody
 * can see the thing they want and is told nothing about why they cannot have
 * it. The words are the registry's, keyed by the code the route would refuse
 * with, so the screen and the refusal cannot say different things.
 */
function RemovePasswordButton({
  offered,
  verdict,
  accountId,
  isPending,
  onAsk,
}: {
  offered: boolean;
  /** What the detach guard would say, or nothing where it has not answered. */
  verdict: AccountIdentifier | null;
  accountId: string | null;
  isPending: boolean;
  onAsk: (target: SignInMethodRemovalTarget) => void;
}) {
  if (!offered || !verdict || !accountId) return null;

  const button = (
    <Button
      size="sm"
      variant="ghost"
      colorPalette="red"
      disabled={!verdict.removable || isPending}
      onClick={() =>
        onAsk({
          accountId,
          name: "your password",
          demotesFirst: verdict.demotesFirst,
        })
      }
      data-testid="remove-password"
    >
      Remove password
    </Button>
  );

  if (verdict.removable || !verdict.refusalCode) return button;

  return (
    <Tooltip content={refusalCopy(verdict.refusalCode)} showArrow>
      {/* The trigger has to be something that still receives pointer events,
          which a disabled button does not — so the wrapper is the trigger. */}
      <Box data-testid="remove-password-blocked">{button}</Box>
    </Tooltip>
  );
}

/**
 * The read that decides whether a password can be given up, when it failed.
 *
 * Not a missing button and not a muted apology: a failure that is still true
 * while somebody is looking at it is an alert, and its words come from the
 * code the read was refused with. Only where there IS a password to give up —
 * an alert about removing something that does not exist is an apology for
 * nothing.
 */
function RemovalVerdictAlert({
  offered,
  error,
}: {
  offered: boolean;
  error: unknown;
}) {
  if (!offered) return null;
  return (
    <SectionErrorNotice
      error={error}
      fallbackTitle="Couldn't check whether this password can be removed"
    />
  );
}

/**
 * The password this account signs in with: setting a first one, changing it,
 * and giving it up.
 *
 * Its own section since the settings redesign. It shared one with the linked
 * accounts for as long as both were rows of the same database table, which is
 * a fact about our storage and never a fact about the person reading: a
 * password is something you choose and change, and a linked account is
 * something you connect and disconnect.
 *
 * Spec: specs/identity/authentication-settings.feature
 */
export function PasswordSection() {
  const publicEnv = usePublicEnv();
  const accounts = api.user.getLinkedAccounts.useQuery({});
  const passwordStatus = api.user.hasPassword.useQuery({});
  const removal = useSignInMethodRemoval({
    successTitle: "Password removed",
    failureTitle: "Couldn't remove your password",
  });
  const [dialogOpen, setDialogOpen] = useState(false);

  const offer = passwordOffer({
    provider: publicEnv.data?.NEXTAUTH_PROVIDER,
    accounts: accounts.data ?? [],
    hasPasswordAnswer: passwordStatus.data?.hasPassword,
  });
  if (!offer) return null;

  const hasPassword = offer.held;
  const passwordAccount = offer.account;
  const canGiveUp = hasPassword && passwordAccount !== null;
  const verdict = passwordAccount
    ? removal.verdictFor(passwordAccount.id)
    : null;

  return (
    <SettingsSection
      anchorId={PASSWORD_ANCHOR}
      icon={<KeyRound size={18} />}
      title="Password"
      description="The password this account signs in with, on the screens that ask for one."
      testId="password-settings-section"
    >
      <VStack
        width="full"
        align="stretch"
        gap={4}
        data-testid="password-section"
      >
        {accounts.isLoading ? <SettingsRowsSkeleton rows={1} /> : null}

        {hasPassword ? (
          // The same row a passkey and an authenticator get: one thing this
          // account holds, with a mark, a name and what can be done to it.
          <SettingsSectionRow testId="password-row">
            <Box color="fg.muted" display="flex">
              <KeyRound size={16} />
            </Box>
            <VStack align="start" gap={0} minWidth={0}>
              <Text fontSize="sm" fontWeight={500}>
                Password
              </Text>
              <Text fontSize="xs" color="fg.muted">
                Used on the screens that ask for one.
              </Text>
            </VStack>
            <Spacer />
            <HStack gap={2}>
              <Button
                size="xs"
                variant="outline"
                onClick={() => setDialogOpen(true)}
                data-testid="password-action"
              >
                Change Password
              </Button>
              <RemovePasswordButton
                // Nothing to give up until there IS one, and nothing to ask
                // the guard about until a row carries it.
                offered={canGiveUp}
                verdict={verdict}
                isPending={removal.isRemoving}
                onAsk={removal.ask}
                accountId={passwordAccount?.id ?? null}
              />
            </HStack>
          </SettingsSectionRow>
        ) : (
          <SettingsEmptyState
            icon={<KeyRound size={20} />}
            title="No password set"
            description="You sign in without one. Setting a password gives you a second way in, for a browser or a device your passkey provider does not reach."
            testId="password-empty"
            action={
              <Button
                variant="outline"
                onClick={() => setDialogOpen(true)}
                data-testid="password-action"
              >
                Set a password
              </Button>
            }
          />
        )}

        <RemovalVerdictAlert
          offered={canGiveUp}
          error={removal.verdictsError}
        />

        <ChangePasswordDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          mode={hasPassword ? "change" : "set"}
        />

        <RemoveSignInMethodDialog
          target={removal.target}
          staysBehind={removal.staysBehind}
          // A password never comes back on its own, whatever the organization
          // signs people in with.
          organizationEnforcesSso={false}
          isRemoving={removal.isRemoving}
          onClose={removal.cancel}
          onConfirm={removal.confirm}
        />
      </VStack>
    </SettingsSection>
  );
}
