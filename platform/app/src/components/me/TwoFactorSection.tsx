import {
  Badge,
  Box,
  Button,
  Field,
  HStack,
  Input,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Smartphone } from "lucide-react";
import { useState } from "react";
import { BackupCodesPanel } from "~/components/me/twoFactor/BackupCodesPanel";
import { TwoFactorSetupFlow } from "~/components/me/twoFactor/TwoFactorSetupFlow";
import { SettingsRowsSkeleton } from "~/components/settings/kit/SettingsSkeleton";
import { SettingsEmptyState } from "~/components/settings/SettingsEmptyState";
import {
  SettingsSection,
  SettingsSectionRow,
} from "~/components/settings/SettingsSection";
import { Dialog } from "~/components/ui/dialog";
import { toaster } from "~/components/ui/toaster";
import { showErrorToast } from "~/features/errors";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { api } from "~/utils/api";
import { authClient } from "~/utils/auth-client";

/**
 * Two-step verification, in the one place somebody goes looking for it: the
 * security settings screen, beside passkeys.
 *
 * Beside them rather than above or below, because the two are not competing.
 * A passkey is a way IN — it replaces the password. Two-step verification
 * stands behind whatever way in somebody used. Ordering them as a preference
 * would make an argument neither of them supports.
 *
 * The whole section is gated on whether the deployment mounted the plugin, in
 * exactly the way passkeys are: a button that exists calling an endpoint that
 * does not is worse than no button.
 */
export function TwoFactorSection() {
  const publicEnv = usePublicEnv();
  const account = api.twoStepVerification.account.useQuery(
    {},
    { enabled: publicEnv.data?.MFA_ENROLLMENT_OPEN === true },
  );
  const [isSettingUp, setIsSettingUp] = useState(false);
  const [isTurningOff, setIsTurningOff] = useState(false);
  const [regenerated, setRegenerated] = useState<readonly string[] | null>(
    null,
  );

  // A deployment that never mounted the plugin has no endpoint behind any of
  // this, and nothing about the feature exists there — not the offer, not the
  // status, not the words.
  if (publicEnv.data?.MFA_ENROLLMENT_OPEN !== true) return null;

  const enabled = account.data?.enabled === true;

  return (
    <SettingsSection
      anchorId="two-step-verification"
      // A phone rather than a shield: this is a code from the device in
      // somebody's pocket, and a shield is what every security feature in
      // every product wears.
      icon={<Smartphone size={18} />}
      title="Two-step verification"
      description="Ask for a code from your phone as well as your password. Somebody who learns your password still cannot sign in as you."
      badge={
        enabled ? (
          <Badge colorPalette="green" data-testid="two-factor-status">
            On
          </Badge>
        ) : null
      }
      testId="two-factor-settings-section"
    >
      <VStack
        width="full"
        align="start"
        gap={4}
        data-testid="two-factor-section"
      >
        {account.isPending ? <SettingsRowsSkeleton rows={1} /> : null}

        {!account.isPending && !enabled ? (
          <SettingsEmptyState
            icon={<Smartphone size={20} />}
            title="Two-step verification is off"
            description="Setting it up takes a minute and an app on your phone that makes sign-in codes."
            testId="two-factor-empty"
            action={
              <Button
                variant="outline"
                onClick={() => setIsSettingUp(true)}
                data-testid="set-up-two-factor"
              >
                Set up two-step verification
              </Button>
            }
          />
        ) : null}

        {enabled ? (
          // The same row a passkey gets, for the same reason: it is one thing
          // this account holds, with a mark, a name and what can be done to
          // it. A paragraph with buttons under it made the one enrolled thing
          // on the page look unlike every other enrolled thing on the page.
          <SettingsSectionRow testId="two-factor-enabled">
            <Box color="fg.muted" display="flex">
              <Smartphone size={16} />
            </Box>
            <VStack align="start" gap={0} minWidth={0}>
              <Text fontSize="sm" fontWeight={500}>
                Authenticator app
              </Text>
              <Text fontSize="xs" color="fg.muted">
                A code is asked for every time you sign in. Backup codes let you
                in when the app that makes them is not to hand.
              </Text>
            </VStack>
            <Spacer />
            <HStack gap={2} align="start">
              <RegenerateBackupCodesButton onGenerated={setRegenerated} />
              <TurnOffButton
                onOpen={() => setIsTurningOff(true)}
                requiringOrganizations={
                  account.data?.requiringOrganizations ?? []
                }
              />
            </HStack>
          </SettingsSectionRow>
        ) : null}

        <Dialog.Root
          open={isSettingUp}
          onOpenChange={(details) => {
            if (!details.open) setIsSettingUp(false);
          }}
          placement="center"
        >
          <Dialog.Content bg="bg">
            <Dialog.CloseTrigger />
            <Dialog.Header>
              <Dialog.Title fontSize="md" fontWeight="500">
                Set up two-step verification
              </Dialog.Title>
            </Dialog.Header>
            <Dialog.Body paddingBottom={6}>
              <TwoFactorSetupFlow
                onFinished={() => {
                  setIsSettingUp(false);
                  void account.refetch();
                  toaster.success({ title: "Two-step verification is on" });
                }}
                onCancel={() => setIsSettingUp(false)}
              />
            </Dialog.Body>
          </Dialog.Content>
        </Dialog.Root>

        <Dialog.Root
          open={regenerated !== null}
          onOpenChange={(details) => {
            if (!details.open) setRegenerated(null);
          }}
          placement="center"
        >
          <Dialog.Content bg="bg">
            <Dialog.CloseTrigger />
            <Dialog.Header>
              <Dialog.Title fontSize="md" fontWeight="500">
                Your new backup codes
              </Dialog.Title>
            </Dialog.Header>
            <Dialog.Body paddingBottom={6}>
              {regenerated ? (
                <BackupCodesPanel
                  codes={regenerated}
                  onDone={() => setRegenerated(null)}
                />
              ) : null}
            </Dialog.Body>
          </Dialog.Content>
        </Dialog.Root>

        <TurnOffDialog
          open={isTurningOff}
          onClose={() => setIsTurningOff(false)}
          onTurnedOff={() => {
            setIsTurningOff(false);
            void account.refetch();
          }}
        />
      </VStack>
    </SettingsSection>
  );
}

/**
 * A fresh set, replacing whatever was left of the old one.
 *
 * The old codes stop working the moment the new ones are issued, which is
 * what the confirmation says — somebody who has printed the old list needs to
 * know it is now waste paper.
 */
function RegenerateBackupCodesButton({
  onGenerated,
}: {
  onGenerated: (codes: readonly string[]) => void;
}) {
  const [password, setPassword] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  // Only an account that HAS a password is asked for one; the plugin waives
  // the check for the rest (`allowPasswordless`), so the screen and the server
  // agree about who can be asked.
  const passwordStatus = api.user.hasPassword.useQuery({});
  const holdsPassword = passwordStatus.data?.hasPassword ?? true;

  const generate = async () => {
    setIsGenerating(true);
    try {
      const result = await authClient.twoFactor.generateBackupCodes(
        holdsPassword ? { password } : {},
      );
      if (result.error) {
        showErrorToast({
          error: result.error,
          fallbackTitle: "Those codes weren't generated",
        });
        return;
      }
      setIsOpen(false);
      setPassword("");
      onGenerated(result.data?.backupCodes ?? []);
    } catch (error) {
      showErrorToast({
        error,
        fallbackTitle: "Those codes weren't generated",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsOpen(true)}
        data-testid="regenerate-backup-codes"
      >
        Get new backup codes
      </Button>
      <Dialog.Root
        open={isOpen}
        onOpenChange={(details) => {
          if (!details.open) setIsOpen(false);
        }}
        placement="center"
      >
        <Dialog.Content bg="bg">
          <Dialog.CloseTrigger />
          <Dialog.Header>
            <Dialog.Title fontSize="md" fontWeight="500">
              Get new backup codes
            </Dialog.Title>
          </Dialog.Header>
          <Dialog.Body paddingBottom={6}>
            <VStack align="stretch" gap={4}>
              <Text fontSize="sm">
                Your current backup codes stop working straight away, including
                any you have written down or printed.
              </Text>
              {holdsPassword ? (
                <Field.Root>
                  <Field.Label>Confirm your password</Field.Label>
                  <Input
                    type="password"
                    value={password}
                    autoComplete="current-password"
                    onChange={(event) => setPassword(event.target.value)}
                    data-testid="regenerate-password"
                  />
                </Field.Root>
              ) : null}
              <HStack gap={3} justify="end">
                <Button variant="outline" onClick={() => setIsOpen(false)}>
                  Cancel
                </Button>
                <Button
                  colorPalette="orange"
                  loading={isGenerating}
                  disabled={holdsPassword && password.length === 0}
                  onClick={() => void generate()}
                  data-testid="confirm-regenerate-backup-codes"
                >
                  Get new codes
                </Button>
              </HStack>
            </VStack>
          </Dialog.Body>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}

/**
 * The button, and the sentence beside it when an organization will not allow
 * it.
 *
 * The refusal is enforced on the server whatever this renders — a check the
 * browser performs is not a check. Saying it here as well is about not
 * walking somebody through a password and a code for a request that was never
 * going to succeed.
 */
function TurnOffButton({
  onOpen,
  requiringOrganizations,
}: {
  onOpen: () => void;
  requiringOrganizations: readonly { name: string }[];
}) {
  const held = requiringOrganizations.length > 0;
  return (
    <VStack align="start" gap={1}>
      <Button
        variant="outline"
        size="sm"
        colorPalette={held ? undefined : "red"}
        disabled={held}
        onClick={onOpen}
        data-testid="turn-off-two-factor"
      >
        Turn off
      </Button>
      {held ? (
        <Text fontSize="xs" color="fg.muted" data-testid="two-factor-held-by">
          {requiringOrganizations.map((one) => one.name).join(", ")} requires
          two-step verification. To turn it off, leave that organization, or ask
          an administrator to reset two-step verification for you, which starts
          a fresh setup.
        </Text>
      ) : null}
    </VStack>
  );
}

/** Password and a current code, because both are what turning it off costs. */
function TurnOffDialog({
  open,
  onClose,
  onTurnedOff,
}: {
  open: boolean;
  onClose: () => void;
  onTurnedOff: () => void;
}) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const disable = api.twoStepVerification.disable.useMutation();

  const turnOff = () => {
    disable.mutate(
      { password, code },
      {
        onSuccess: () => {
          setPassword("");
          setCode("");
          toaster.success({ title: "Two-step verification is off" });
          onTurnedOff();
        },
        // Never `error.message`: the code-keyed registry owns the words, and
        // the wire message is the code slug.
        onError: (error) =>
          showErrorToast({
            error,
            fallbackTitle: "That wasn't turned off",
          }),
      },
    );
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(details) => {
        if (!details.open) onClose();
      }}
      placement="center"
    >
      <Dialog.Content bg="bg">
        <Dialog.CloseTrigger />
        <Dialog.Header>
          <Dialog.Title fontSize="md" fontWeight="500">
            Turn off two-step verification
          </Dialog.Title>
        </Dialog.Header>
        <Dialog.Body paddingBottom={6}>
          <VStack align="stretch" gap={4}>
            <Text fontSize="sm">
              You will sign in with your password alone from then on. Your
              backup codes stop working too.
            </Text>
            <Field.Root>
              <Field.Label>Confirm your password</Field.Label>
              <Input
                type="password"
                value={password}
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
                data-testid="turn-off-password"
              />
            </Field.Root>
            <Field.Root>
              <Field.Label>Enter the code from your app</Field.Label>
              <Input
                value={code}
                inputMode="numeric"
                autoComplete="one-time-code"
                onChange={(event) => setCode(event.target.value.trim())}
                data-testid="turn-off-code"
              />
            </Field.Root>
            <HStack gap={3} justify="end">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                colorPalette="red"
                loading={disable.isPending}
                disabled={password.length === 0 || code.length === 0}
                onClick={turnOff}
                data-testid="confirm-turn-off-two-factor"
              >
                Turn off
              </Button>
            </HStack>
          </VStack>
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  );
}
