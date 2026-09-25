/**
 * Whether every member must prove a second factor. The server enforces it; the
 * switch stays available for turning it off after an Enterprise plan lapses.
 * Spec: specs/identity/mfa-and-session-shape.feature
 */
import { Alert, Badge, Box, HStack, Link, Text } from "@chakra-ui/react";
import { SettingsCard } from "@langwatch/design-system/settings-card";
import { Switch } from "@langwatch/design-system/switch";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { Lock } from "lucide-react";

const OFF_EXPLANATION =
  "Requiring two-step verification of every member is part of the Enterprise plan. Members can still set it up on their own accounts.";
const HELD_EXPLANATION =
  "Your plan no longer includes this requirement. Your members are still being asked for a second factor, and you can turn that off. Turning it back on needs the Enterprise plan.";

export function TwoStepRequirementCard({
  mfaRequired,
  heldCount,
  memberCount,
  connection,
  canTurnOn,
  planLocked,
  planLink,
  saving,
  onChange,
}: {
  mfaRequired: boolean;
  heldCount: number;
  memberCount: number;
  connection: { connected: boolean; assertsSecondFactor: boolean };
  canTurnOn: boolean;
  planLocked: boolean;
  planLink: { href: string; label: string };
  saving: boolean;
  onChange: (mfaRequired: boolean) => void;
}) {
  const explanation = mfaRequired ? HELD_EXPLANATION : OFF_EXPLANATION;

  return (
    <SettingsCard
      title="Require two-step verification"
      hint="A code, a passkey, or one their identity provider confirms. Turning it on signs nobody out."
      badge={
        <HStack gap={2}>
          {planLocked && (
            <Badge colorPalette="purple" data-testid="two-step-requirement-plan-badge">
              Enterprise
            </Badge>
          )}
          {/* The tooltip hangs off a wrapper: a disabled switch takes no pointer events. */}
          <Tooltip content={explanation} disabled={!planLocked || mfaRequired}>
            <Box>
              <Switch
                checked={mfaRequired}
                disabled={saving || (!canTurnOn && !mfaRequired)}
                onCheckedChange={(details) => onChange(details.checked)}
                aria-label="Require two-step verification"
                inputProps={{ "data-testid": "two-step-requirement-switch" }}
              />
            </Box>
          </Tooltip>
        </HStack>
      }
      data-testid="two-step-requirement-card"
    >
      {planLocked && (
        <HStack gap={2} align="start" data-testid="two-step-requirement-plan-notice">
          <Box color="fg.muted" marginTop="1px" flexShrink={0}>
            <Lock size={14} />
          </Box>
          <Text color="fg.muted" fontSize="xs">
            {explanation}{" "}
            <Link href={planLink.href} colorPalette="orange" color="colorPalette.fg">
              {planLink.label}
            </Link>
          </Text>
        </HStack>
      )}

      <Text fontSize="sm" data-testid="two-step-held-count">
        {heldCount === 0
          ? `All ${memberCount} members can prove a second factor.`
          : `${heldCount} of ${memberCount} members cannot prove a second factor yet${
              mfaRequired
                ? " and are being asked to set one up."
                : " and would be asked to set one up."
            }`}
      </Text>

      {connection.connected && !connection.assertsSecondFactor ? (
        <Alert.Root status="warning" data-testid="two-step-connection-warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>
              Your identity provider is not telling us that a second factor was used when your
              members sign in.
            </Alert.Title>
            <Alert.Description>
              Until it does, members who sign in through it are asked to set two-step verification
              up here as well. You can turn a second factor on at your identity provider instead,
              and it will count for them the moment it starts confirming one.
            </Alert.Description>
          </Alert.Content>
        </Alert.Root>
      ) : null}
    </SettingsCard>
  );
}
