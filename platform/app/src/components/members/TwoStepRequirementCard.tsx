import { Box, HStack, Link, Text } from "@chakra-ui/react";
import { Lock } from "lucide-react";
import { useEnterpriseLock } from "~/components/access/useEnterpriseLock";
import { EnterprisePlanBadge } from "~/components/enterprise/EnterprisePlanBadge";
import { SettingsCard } from "~/components/settings/kit/SettingsCard";
import { QuietNotice } from "~/components/settings/QuietNotice";
import { Switch } from "~/components/ui/switch";
import { Tooltip } from "~/components/ui/tooltip";

/** What this organization's identity provider is asserting, if it has one. */
export interface ConnectionSecondFactorView {
  connected: boolean;
  assertsSecondFactor: boolean;
}

/** The server enforces this requirement; the card keeps disabling it available
 * after an Enterprise plan lapses. */
export function TwoStepRequirementCard({
  mfaRequired,
  heldCount,
  memberCount,
  connection,
  saving,
  onChange,
}: {
  mfaRequired: boolean;
  heldCount: number;
  memberCount: number;
  connection: ConnectionSecondFactorView;
  saving: boolean;
  onChange: (mfaRequired: boolean) => void;
}) {
  const lock = useEnterpriseLock({
    held: mfaRequired,
    offExplanation:
      "Requiring two-step verification of every member is part of the Enterprise plan. Members can still set it up on their own accounts.",
    heldExplanation:
      "Your plan no longer includes this requirement. Your members are still being asked for a second factor, and you can turn that off — turning it back on needs the Enterprise plan.",
  });
  const locked = lock.locked;

  return (
    <SettingsCard
      title="Require two-step verification"
      // ONE LINE, AND IT SPENDS ITS SECOND HALF ON THE FEAR. What a second
      // factor IS needs no explaining to the person who administers an
      // organization; the belief that turning this on signs everybody out is
      // the single commonest reason they do not, and that is what the
      // sentence is for.
      hint="A code, a passkey, or one their identity provider confirms. Turning it on signs nobody out."
      badge={
        <HStack gap={2}>
          {locked && (
            <EnterprisePlanBadge data-testid="two-step-requirement-plan-badge" />
          )}
          {/* THE SWITCH STANDS WHERE THE BADGE STANDS. This card answers one
              question — is the requirement on — and the control that answers
              it belongs beside the title, in the place every card in the
              cluster reserves for the state. The tooltip hangs off a wrapper
              rather than the switch: a disabled control takes no pointer
              events, so an explanation pinned to it is one nobody can ever
              read. */}
          <Tooltip
            content={lock.explanation}
            disabled={!lock.locked || mfaRequired}
          >
            <Box>
              <Switch
                checked={mfaRequired}
                // Turning it OFF is never gated, so an organization that
                // moved off the plan with the requirement on can still
                // release its members.
                disabled={saving || (!lock.canTurnOn && !mfaRequired)}
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
      {locked && (
        <HStack
          gap={2}
          align="start"
          data-testid="two-step-requirement-plan-notice"
        >
          {/* One pixel down: the glyph optically aligned to the line beside
              it, which mathematical alignment always misses. */}
          <Box color="fg.muted" marginTop="1px" flexShrink={0}>
            <Lock size={14} />
          </Box>
          <Text color="fg.muted" fontSize="11.5px" lineHeight="1.55">
            {lock.explanation}{" "}
            {/* THE WAY OUT IS THE BRAND COLOUR, NOT A SECOND BLUE. This link
                used to wear `blue.600`, a colour nothing else on these pages
                speaks; the way to a plan is an action, and actions here are
                orange. */}
            <Link
              href={lock.linkHref}
              colorPalette="orange"
              color="colorPalette.fg"
            >
              {lock.linkLabel}
            </Link>
          </Text>
        </HStack>
      )}

      <Text fontSize="13px" data-testid="two-step-held-count">
        {heldCount === 0
          ? `All ${memberCount} members can prove a second factor.`
          : `${heldCount} of ${memberCount} members cannot prove a second factor yet${
              mfaRequired
                ? " and are being asked to set one up."
                : " and would be asked to set one up."
            }`}
      </Text>

      {/* The provider's shortcoming is a WARNING, in the one notice these
          screens speak — never a coloured box of this card's own invention. */}
      {connection.connected && !connection.assertsSecondFactor ? (
        <QuietNotice
          tone="warning"
          title="Your identity provider is not telling us that a second factor was used when your members sign in."
          testId="two-step-connection-warning"
        >
          Until it does, members who sign in through it are asked to set
          two-step verification up here as well. You can turn a second factor on
          at your identity provider instead, and it will count for them the
          moment it starts confirming one.
        </QuietNotice>
      ) : null}
    </SettingsCard>
  );
}
