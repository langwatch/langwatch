import {
  Box,
  Button,
  HStack,
  Input,
  Link,
  RadioGroup,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { DomainJoinSetting } from "@langwatch/identity";
import { Lock } from "lucide-react";
import { useState } from "react";
import { EnterprisePlanBadge } from "~/components/enterprise/EnterprisePlanBadge";
import { SettingsCard } from "~/components/settings/kit/SettingsCard";
import { Tooltip } from "~/components/ui/tooltip";
import {
  ARRIVAL_ANSWERS,
  type ArrivalAnswer,
  arrivalAnswerLabel,
} from "~/features/sso/logic/arrivals";
import { useEnterpriseLock } from "./useEnterpriseLock";

/**
 * Who can join this organization without being invited (D12).
 *
 * Three settings and no fourth. The copy says what each one does FOR the
 * reader and never how it is built — no "domain matcher", no "identifier
 * projection" — and the automatic option names its own cost in the same
 * breath as its benefit, because somebody walking in with nobody in the loop
 * is a thing an administrator should agree to on purpose.
 *
 * OPENING THE DOOR IS AN ENTERPRISE CONTROL; CLOSING IT IS NOT. Both open
 * options are on screen on every plan, greyed with the reason on them rather
 * than hidden, because an administrator who cannot see a control cannot tell
 * it apart from one that does not exist. "Nobody" is never greyed, and an
 * organization already on an open setting keeps that setting selectable, so a
 * plan that lapses is never a door somebody cannot shut. `setJoining` refuses
 * the same way on its own (`join_policy_not_licensed`): the greying is a
 * courtesy to whoever is reading, and the service is the boundary.
 *
 * The chrome is the settings kit's — `SettingsCard`, the same shape every
 * card in the cluster wears — so this page cannot drift into a dialect of its
 * own. What is this card's own is the content: the three radios, and the
 * domain box the automatic option earns.
 *
 * ONE QUESTION, TWO DOORS, ONE VOCABULARY. The single sign-on journey asks
 * the same three answers of the people who arrive THROUGH a connection
 * (ADR-117 §3), so the answers' order and labels come from the shared module
 * rather than being retyped here — retyped, they drifted once already. The
 * help lines are this door's own: no account is carried over on this door,
 * and the automatic option still names its own cost beside the shared label,
 * because somebody walking in with nobody in the loop is a thing an
 * administrator should agree to on purpose.
 */
const SETTING_BY_ANSWER: Record<ArrivalAnswer, DomainJoinSetting> = {
  closed: "off",
  approve: "request",
  open: "auto",
};

const HELP_BY_ANSWER: Record<ArrivalAnswer, string> = {
  closed: "Invitations still work.",
  approve: "On a verified address at your domain.",
  open: "Nobody approves each person — you are emailed each time.",
};

const OPTIONS: Array<{
  value: DomainJoinSetting;
  label: string;
  help: string;
}> = ARRIVAL_ANSWERS.map((answer) => ({
  value: SETTING_BY_ANSWER[answer],
  label: arrivalAnswerLabel(answer),
  help: HELP_BY_ANSWER[answer],
}));

export function JoinPolicyCard({
  domainJoin,
  joinDomains,
  saving,
  onSave,
  ssoLive = false,
}: {
  domainJoin: DomainJoinSetting;
  joinDomains: string[];
  saving: boolean;
  onSave: (next: { domainJoin: DomainJoinSetting; domains: string[] }) => void;
  /** A connection is routing sign-ins, so the SSO door has its own answer to
   *  this question — the card points at it rather than letting a reader set
   *  it here twice. */
  ssoLive?: boolean;
}) {
  const [selected, setSelected] = useState<DomainJoinSetting>(domainJoin);
  const [domains, setDomains] = useState(joinDomains.join(", "));

  const lock = useEnterpriseLock({
    held: domainJoin !== "off",
    offExplanation:
      "Choosing who can join without an invitation is part of the Enterprise plan. You can still invite people by email on any plan.",
    heldExplanation:
      "Your plan no longer includes this control. Your current setting is still in force, and you can close the door at any time — reopening it needs the Enterprise plan.",
  });

  /**
   * An option this organization cannot move to. Closing the door is free, and
   * the setting already saved stays selectable so nobody is stranded on a
   * radio they cannot re-select after glancing at another.
   */
  const isLocked = (value: DomainJoinSetting) =>
    lock.locked && value !== "off" && value !== domainJoin;

  const parsedDomains = domains
    .split(",")
    .map((domain) => domain.trim())
    .filter(Boolean);
  const unchanged =
    selected === domainJoin &&
    parsedDomains.join(",") === joinDomains.join(",");

  return (
    <SettingsCard
      title="Who can join your organization"
      // WHICH PEOPLE THIS IS ABOUT, and it is the half a reader guesses at:
      // where a connection is live for a domain, its own provisioning is the
      // way in and this is deliberately not offered beside it. So this governs
      // exactly the arrivals single sign-on does not catch — one clause,
      // because the reader came to move a radio and not to read a page.
      hint="For colleagues who arrive without single sign-on."
      badge={
        lock.locked ? (
          <EnterprisePlanBadge data-testid="join-policy-plan-badge" />
        ) : undefined
      }
      actions={
        <Button
          size="sm"
          colorPalette="orange"
          loading={saving}
          disabled={unchanged || isLocked(selected)}
          onClick={() =>
            onSave({ domainJoin: selected, domains: parsedDomains })
          }
        >
          Save
        </Button>
      }
      data-testid="join-policy-card"
    >
      {lock.locked && (
        <HStack gap={2} align="start" data-testid="join-policy-notice">
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

      <RadioGroup.Root
        value={selected}
        onValueChange={(event) =>
          setSelected((event.value ?? "request") as DomainJoinSetting)
        }
      >
        <VStack align="stretch" gap={3}>
          {OPTIONS.map((option) => (
            // The tooltip hangs off a wrapper rather than the radio: a
            // disabled control takes no pointer events, so an explanation
            // pinned to it is one nobody can ever read.
            <Tooltip
              key={option.value}
              content={lock.explanation}
              disabled={!isLocked(option.value)}
            >
              <Box>
                <RadioGroup.Item
                  value={option.value}
                  disabled={saving || isLocked(option.value)}
                >
                  <RadioGroup.ItemHiddenInput
                    data-testid={`join-policy-${option.value}`}
                  />
                  <RadioGroup.ItemIndicator />
                  <RadioGroup.ItemText>
                    <VStack align="start" gap={0}>
                      <Text fontSize="13px" fontWeight="500" lineHeight="1.4">
                        {option.label}
                      </Text>
                      <Text color="fg.muted" fontSize="11.5px" lineHeight="1.5">
                        {option.help}
                      </Text>
                    </VStack>
                  </RadioGroup.ItemText>
                </RadioGroup.Item>
              </Box>
            </Tooltip>
          ))}
        </VStack>
      </RadioGroup.Root>

      {selected === "auto" && (
        <VStack align="stretch" gap={1}>
          <Text fontSize="13px" fontWeight="500">
            Which domains, separated by commas
          </Text>
          <Input
            value={domains}
            placeholder="acme.com"
            disabled={isLocked("auto")}
            onChange={(event) => setDomains(event.target.value)}
            data-testid="join-policy-domains"
          />
          {/* What opens this door is the same verification ceremony
              sign-in routing uses — never a count of who happens to
              receive mail on the domain. */}
          <Text color="fg.muted" fontSize="11.5px">
            Each must be verified as yours first.
          </Text>
        </VStack>
      )}

      {/* THE OTHER DOOR, NAMED. This card answers for people who arrive
          WITHOUT single sign-on; the people a live connection signs in are
          answered by its own setting, and a reader holding both questions
          should be handed that door rather than left to answer it here
          twice. */}
      {ssoLive && (
        <Text color="fg.subtle" fontSize="11.5px">
          People signing in through your identity provider are answered by the
          connection's own setting, on{" "}
          <Link
            href="/settings/authentication/provider"
            colorPalette="orange"
            color="colorPalette.fg"
          >
            Identity provider
          </Link>
          .
        </Text>
      )}
    </SettingsCard>
  );
}
