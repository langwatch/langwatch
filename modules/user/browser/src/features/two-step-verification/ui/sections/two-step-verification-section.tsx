import { Card } from "@langwatch/design-system/card";
import { Badge, Button, Text } from "@langwatch/design-system/primitives";
import { SettingsSection } from "@langwatch/design-system/settings-section";
/**
 * Two-step verification, beside passkeys: a passkey is a way in, this stands
 * behind whichever way in was used. Absent entirely where the deployment offers none.
 * Spec: specs/identity/mfa-and-session-shape.feature
 */
import { SkeletonRows } from "@langwatch/design-system/skeletons";
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
    <SettingsSection
      anchorId="two-step-verification"
      icon={<Smartphone size={18} />}
      title="Two-step verification"
      hint="Ask for a code from your phone as well as your password. Somebody who learns your password still cannot sign in as you."
      badge={
        twoStep.enabled ? (
          <Badge colorPalette="green" data-testid="two-factor-status">
            On
          </Badge>
        ) : null
      }
      data-testid="two-factor-section"
    >
      {twoStep.loading ? <SkeletonRows rows={2} /> : null}

      {!twoStep.loading && !twoStep.enabled ? (
        <Card
          titleLevel={3}
          title="Two-step verification is off"
          description="Setting it up takes a minute and an app on your phone that makes sign-in codes."
          actions={
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsSettingUp(true)}
              data-testid="set-up-two-factor"
            >
              Set up two-step verification
            </Button>
          }
          data-testid="two-factor-empty"
        />
      ) : null}

      {twoStep.enabled ? (
        <Card
          titleLevel={3}
          icon={<Smartphone size={16} />}
          title="Authenticator app"
          description="A code is asked for every time you sign in. Backup codes let you in when the app that makes them is not to hand."
          actions={
            <>
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
            </>
          }
          data-testid="two-factor-enabled"
        >
          {held ? (
            <Text fontSize="xs" color="fg.muted" data-testid="two-factor-held-by">
              {twoStep.requiringOrganizations.map((one) => one.name).join(", ")} requires two-step
              verification. To turn it off, leave that organization, or ask an administrator to
              reset two-step verification for you, which starts a fresh setup.
            </Text>
          ) : null}
        </Card>
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
    </SettingsSection>
  );
}
