import { Box, HStack, Link, Text } from "@chakra-ui/react";
import { Lock } from "lucide-react";
import { EnterprisePlanBadge } from "~/components/enterprise/EnterprisePlanBadge";
import { SettingsCard } from "~/components/settings/kit/SettingsCard";
import { QuietNotice } from "~/components/settings/QuietNotice";
import { Switch } from "~/components/ui/switch";
import { Tooltip } from "~/components/ui/tooltip";
import { useActivePlan } from "~/hooks/useActivePlan";
import { usePublicEnv } from "~/hooks/usePublicEnv";

/** What this organization's identity provider is asserting, if it has one. */
export interface ConnectionSecondFactorView {
  connected: boolean;
  assertsSecondFactor: boolean;
}

/**
 * Whether this organization's plan carries the requirement, and the words to
 * say when it does not.
 *
 * Two states rather than one, because an organization can hold the
 * requirement without holding the plan — it turned it on and then moved off
 * Enterprise. Its members are still being asked, and the administrator has
 * to be able to turn it OFF, or a lapsed plan would be a lockout they
 * cannot undo. So the plan gates turning it ON and nothing else.
 *
 * The way out differs by deployment: a Cloud customer buys a plan, an
 * operator activates a license, and a "See plans" link on a self-hosted
 * installation leads to a page they cannot buy from.
 */
function useEnterpriseLock({ mfaRequired }: { mfaRequired: boolean }): {
  /** Whether turning the requirement on is available on this plan. */
  canTurnOn: boolean;
  /** The plan is not carrying it, and we know that for certain. */
  locked: boolean;
  /** The switch is inert AND there is a reason worth saying on it. */
  explained: boolean;
  explanation: string;
  linkLabel: string;
  linkHref: string;
} {
  const { isEnterprise, isLoading } = useActivePlan();
  const publicEnv = usePublicEnv();
  const isSaaS = publicEnv.data?.IS_SAAS ?? false;
  // Until the plan is known nothing is marked as locked: a badge that
  // appears and then vanishes for an Enterprise organization tells them
  // something untrue about what they bought.
  const locked = !isEnterprise && !isLoading;

  return {
    canTurnOn: isEnterprise,
    locked,
    explained: locked && !mfaRequired,
    explanation: mfaRequired
      ? "Your plan no longer includes this requirement. Your members are still being asked for a second factor, and you can turn that off — turning it back on needs the Enterprise plan."
      : "Requiring two-step verification of every member is part of the Enterprise plan. Members can still set it up on their own accounts.",
    linkLabel: isSaaS ? "See plans" : "Activate a license",
    linkHref: isSaaS ? "/settings/subscription" : "/settings/license",
  };
}

/**
 * The organization's security setting: every member can prove a second
 * factor (D06).
 *
 * Three sentences do the work here, and each is load-bearing:
 *
 *   - what turning it ON does — asks the members who cannot yet prove one to
 *     set one up, and ends nobody's session. An administrator who thinks this
 *     signs their team out will not turn it on;
 *   - how many members it would hold, said BEFORE the switch. A requirement
 *     turned on blind is how an organization locks out its own staff;
 *   - what the identity provider is doing, when there is one. Members signing
 *     in through a connection that asserts no second factor are held here for
 *     a reason that looks like our fault and is the provider's configuration,
 *     and the administrator has to be told which it is.
 *
 * The card is on screen on every plan and never hidden. An organization
 * whose plan does not carry the requirement gets the switch greyed with the
 * reason on it and a way to the plans, and keeps the count below it — how
 * many members cannot prove a second factor is the honest reason to want
 * this, and hiding it would leave an administrator with an unexplained blank
 * where a security control used to be. The plan is read here, in the card,
 * so the lock travels with it wherever the screen is rebuilt.
 *
 * The greying is a courtesy, not the boundary: `setRequirement` in
 * `organization-mfa.service.ts` refuses the flip on its own.
 *
 * The chrome is the settings kit's — `SettingsCard`, the same shape every
 * card in the cluster wears — and the warning is the one notice these screens
 * speak, in its warning tone. What is this card's own is the content: the
 * switch, the count, and what the provider is asserting.
 */
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
  const lock = useEnterpriseLock({ mfaRequired });
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
          <Tooltip content={lock.explanation} disabled={!lock.explained}>
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
