/**
 * The password this account signs in with, on the screens that ask for one.
 * Its own section since the security-page split. `passwordOfferFor`
 * decides whether this deployment lets the product touch a password at all.
 */

import { Box, Button, HStack, Spacer, Text, VStack } from "@langwatch/design-system/primitives";
import {
  SettingsEmptyState,
  SettingsSection,
  SettingsSectionRow,
} from "@langwatch/design-system/settings-section";
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
import { SSO_HANDLES_SIGN_IN } from "../../model/last-way-in.ts";
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

function SetPasswordAction({
  governedBySso,
  onSet,
}: {
  governedBySso: boolean | undefined;
  onSet: () => void;
}) {
  if (governedBySso === undefined) return null;
  if (governedBySso) {
    return (
      <Text fontSize="sm" color="fg.muted" data-testid="password-sso-governed">
        {SSO_HANDLES_SIGN_IN}
      </Text>
    );
  }
  return (
    <Button variant="outline" onClick={onSet} data-testid="password-action">
      Set a password
    </Button>
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
  const governance = api.identity.mySignInGovernance.useQuery({});
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
    <SettingsSection
      anchorId="password"
      icon={<KeyRound size={18} />}
      title="Password"
      hint="The password this account signs in with, on the screens that ask for one."
      data-testid="password-settings-section"
    >
      <VStack width="full" align="stretch" gap={4} data-testid="password-section">
        {hasPassword ? (
          <SettingsSectionRow data-testid="password-row">
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
              {passwordAccount && verdict ? (
                <RemovePasswordButton
                  verdict={verdict}
                  accountId={passwordAccount.id}
                  isPending={removal.isRemoving}
                  onAsk={removal.ask}
                />
              ) : null}
            </HStack>
          </SettingsSectionRow>
        ) : (
          <SettingsEmptyState
            icon={<KeyRound size={20} />}
            title="No password set"
            description="You sign in without one. Setting a password gives you a second way in, for a browser or a device your passkey provider does not reach."
            data-testid="password-empty"
            action={
              <SetPasswordAction
                governedBySso={governance.data?.governedBySso}
                onSet={() => setDialogOpen(true)}
              />
            }
          />
        )}

        <ChangePasswordDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          mode={hasPassword ? "change" : "set"}
        />

        <RemoveSignInMethodDialog
          target={removal.target}
          staysBehind={removal.staysBehind}
          organizationEnforcesSso={false}
          isRemoving={removal.isRemoving}
          onClose={removal.cancel}
          onConfirm={removal.confirm}
        />
      </VStack>
    </SettingsSection>
  );
}
