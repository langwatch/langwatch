/**
 * Two-step verification, beside passkeys: a passkey is a way in, this stands
 * behind whichever way in was used. Absent entirely where the deployment offers none.
 * Spec: specs/identity/mfa-and-session-shape.feature
 */
import { Badge, Box, Button, Card, HStack, Spacer, Spinner, Text, VStack } from "@chakra-ui/react";
import { Smartphone } from "lucide-react";
import { useState } from "react";

import { useBackupCodesRegeneration } from "../../behavior/use-backup-codes-regeneration.ts";
import { useTwoStepAccount } from "../../behavior/use-two-step-account.ts";
import { RegenerateBackupCodesDialog } from "../blocks/regenerate-backup-codes-dialog.tsx";
import { TurnOffTwoStepDialog } from "../blocks/turn-off-two-step-dialog.tsx";
import { TwoStepDialogs } from "./two-step-dialogs.tsx";

const NO_CODES: readonly string[] = [];

export function TwoStepVerificationSection() {
  const twoStep = useTwoStepAccount();
  const [isTurningOff, setIsTurningOff] = useState(false);
  const [isSettingUp, setIsSettingUp] = useState(false);
  const [isAskingForCodes, setIsAskingForCodes] = useState(false);
  const [regenerated, setRegenerated] = useState<readonly string[]>(NO_CODES);
  const regeneration = useBackupCodesRegeneration({
    onGenerated: (codes) => {
      setIsAskingForCodes(false);
      setRegenerated(codes);
    },
  });

  if (!twoStep.offered) return null;

  const held = twoStep.requiringOrganizations.length > 0;

  return (
    <VStack width="full" align="start" gap={4} data-testid="two-factor-section">
      <VStack align="start" gap={1}>
        <HStack gap={2}>
          <Smartphone size={18} />
          <Text fontWeight={600}>Two-step verification</Text>
          {twoStep.enabled ? (
            <Badge colorPalette="green" data-testid="two-factor-status">
              On
            </Badge>
          ) : null}
        </HStack>
        <Text color="fg.muted" fontSize="sm">
          Ask for a code from your phone as well as your password. Somebody who learns your password
          still cannot sign in as you.
        </Text>
      </VStack>

      {twoStep.loading ? <Spinner size="sm" /> : null}

      {!twoStep.loading && !twoStep.enabled ? (
        <Card.Root width="full" data-testid="two-factor-empty">
          <Card.Body>
            <HStack align="center" gap={3}>
              <VStack align="start" gap={0} minWidth={0}>
                <Text fontSize="sm" fontWeight={500}>
                  Two-step verification is off
                </Text>
                <Text fontSize="xs" color="fg.muted">
                  Setting it up takes a minute and an app on your phone that makes sign-in codes.
                </Text>
              </VStack>
              <Spacer />
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsSettingUp(true)}
                data-testid="set-up-two-factor"
              >
                Set up two-step verification
              </Button>
            </HStack>
          </Card.Body>
        </Card.Root>
      ) : null}

      {twoStep.enabled ? (
        <Card.Root width="full" data-testid="two-factor-enabled">
          <Card.Body>
            <HStack align="start" gap={3}>
              <Box color="fg.muted" display="flex" paddingTop={0.5}>
                <Smartphone size={16} />
              </Box>
              <VStack align="start" gap={0} minWidth={0}>
                <Text fontSize="sm" fontWeight={500}>
                  Authenticator app
                </Text>
                <Text fontSize="xs" color="fg.muted">
                  A code is asked for every time you sign in. Backup codes let you in when the app
                  that makes them is not to hand.
                </Text>
              </VStack>
              <Spacer />
              <HStack align="start" gap={2}>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsAskingForCodes(true)}
                  data-testid="regenerate-backup-codes"
                >
                  Get new backup codes
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  colorPalette={held ? void 0 : "red"}
                  disabled={held}
                  onClick={() => setIsTurningOff(true)}
                  data-testid="turn-off-two-factor"
                >
                  Turn off
                </Button>
              </HStack>
            </HStack>
            {held ? (
              <Text fontSize="xs" color="fg.muted" paddingTop={2} data-testid="two-factor-held-by">
                {twoStep.requiringOrganizations.map((one) => one.name).join(", ")} requires two-step
                verification. To turn it off, leave that organization, or ask an administrator to
                reset two-step verification for you, which starts a fresh setup.
              </Text>
            ) : null}
          </Card.Body>
        </Card.Root>
      ) : null}

      <TurnOffTwoStepDialog
        open={isTurningOff}
        holdsPassword={twoStep.holdsPassword}
        turningOff={twoStep.turningOff}
        onClose={() => setIsTurningOff(false)}
        onConfirm={twoStep.turnOff}
      />

      <RegenerateBackupCodesDialog
        open={isAskingForCodes}
        holdsPassword={twoStep.holdsPassword}
        isGenerating={regeneration.isGenerating}
        onClose={() => setIsAskingForCodes(false)}
        onConfirm={(password) => void regeneration.regenerate(password)}
      />

      <TwoStepDialogs
        isSettingUp={isSettingUp}
        holdsPassword={twoStep.holdsPassword}
        regenerated={regenerated}
        onCloseSetup={() => setIsSettingUp(false)}
        onFinishedSetup={() => {
          setIsSettingUp(false);
          twoStep.setUp();
        }}
        onCloseCodes={() => setRegenerated(NO_CODES)}
      />
    </VStack>
  );
}
