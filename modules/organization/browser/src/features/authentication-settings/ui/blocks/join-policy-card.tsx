import { Link } from "@langwatch/browser-host/link";
/**
 * How people join without an invitation. Opening policies need the Enterprise plan; the saved
 * setting stays selectable after a lapse so it can always be closed.
 * Spec: specs/identity/domain-auto-join.feature
 */
import { Box, Button, HStack, Input, Text, VStack } from "@langwatch/design-system/primitives";
import { RawRadioGroup as RadioGroup } from "@langwatch/design-system/radio";
import { SettingsCard } from "@langwatch/design-system/settings-card";
import { Tooltip } from "@langwatch/design-system/tooltip";
import type { DomainJoinSetting, JoinerRole } from "@langwatch/identity-contract";
import { Lock } from "lucide-react";
import { useState } from "react";

import { EnterprisePlanBadge } from "../../../../ui/elements/enterprise-plan-badge.tsx";

const OPTIONS: { value: DomainJoinSetting; label: string; help: string }[] = [
  { value: "off", label: "Invite only", help: "Only people with an invitation can join." },
  {
    value: "request",
    label: "Approval required",
    help: "People with a verified company address can ask to join.",
  },
  {
    value: "auto",
    label: "Automatic joining",
    help: "People on a verified domain join without waiting for approval.",
  },
];

/**
 * The seat a newcomer lands on. Two choices, said in the reader's terms: a full member sees the
 * shared projects, a Developer gets a project of their own and nothing shared. Applies to
 * everybody admitted without an invitation, whichever door they came through.
 */
const JOINER_SEAT_OPTIONS: { value: JoinerRole; label: string; help: string }[] = [
  {
    value: "MEMBER",
    label: "Member",
    help: "Sees the shared projects and can work in them. Uses a member seat.",
  },
  {
    value: "DEVELOPER",
    label: "Developer",
    help: "Gets a project of their own and nothing shared. Never counted against your seats.",
  },
];

/**
 * Which seat they land on. Shown whenever anybody can get in without an invitation: with the
 * door shut there is nobody to seat. The setting also answers for SSO-admitted arrivals, which
 * is why it sits on this card and not on the identity provider page.
 */
function JoinerSeatOptions({
  seat,
  saving,
  onSelect,
}: {
  seat: JoinerRole;
  saving: boolean;
  onSelect: (seat: JoinerRole) => void;
}) {
  return (
    <VStack align="stretch" gap={2}>
      <Text fontSize="13px" fontWeight="500">
        Seat for people who join
      </Text>
      <RadioGroup.Root
        value={seat}
        colorPalette="orange"
        onValueChange={(event) => onSelect(event.value === "DEVELOPER" ? "DEVELOPER" : "MEMBER")}
      >
        <VStack align="stretch" gap={2}>
          {JOINER_SEAT_OPTIONS.map((option) => (
            <RadioGroup.Item
              key={option.value}
              value={option.value}
              disabled={saving}
              paddingX={2.5}
              paddingY={2}
              borderWidth="1px"
              borderColor="border.muted"
              borderRadius="md"
              background="bg.panel"
              _checked={{
                borderColor: "colorPalette.solid",
                background: "colorPalette.subtle",
              }}
            >
              <RadioGroup.ItemHiddenInput data-testid={`joiner-seat-${option.value}`} />
              <RadioGroup.ItemIndicator />
              <RadioGroup.ItemText>
                <VStack align="start" gap={0}>
                  <Text fontSize="13px" fontWeight="500" lineHeight="1.4">
                    {option.label}
                  </Text>
                  <Text color="fg.muted" fontSize="xs" lineHeight="1.5">
                    {option.help}
                  </Text>
                </VStack>
              </RadioGroup.ItemText>
            </RadioGroup.Item>
          ))}
        </VStack>
      </RadioGroup.Root>
    </VStack>
  );
}

const OFF_EXPLANATION =
  "Choosing who can join without an invitation is part of the Enterprise plan. You can still invite people by email on any plan.";
const HELD_EXPLANATION =
  "Your plan no longer includes this control. Your current setting is still in force, and you can close the door at any time. Reopening it needs the Enterprise plan.";

const splitDomains = (value: string) =>
  value
    .split(",")
    .map((domain) => domain.trim())
    .filter(Boolean);

export function JoinPolicyCard({
  domainJoin,
  joinDomains,
  joinerRole = "MEMBER",
  saving,
  planLocked,
  planLink,
  onSave,
  ssoLive = false,
}: {
  domainJoin: DomainJoinSetting;
  joinDomains: string[];
  /** The seat people who join without an invitation receive. */
  joinerRole?: JoinerRole;
  saving: boolean;
  planLocked: boolean;
  planLink: { href: string; label: string };
  onSave: (next: {
    domainJoin: DomainJoinSetting;
    domains: string[];
    /** Left out when the seat control is hidden: the seat in force stays. */
    joinerRole?: JoinerRole;
  }) => void;
  /** A connection routes sign-ins, so the card points at its own setting. */
  ssoLive?: boolean;
}) {
  const [selected, setSelected] = useState<DomainJoinSetting>(domainJoin);
  const [domains, setDomains] = useState(joinDomains.join(", "));
  const [seat, setSeat] = useState<JoinerRole>(joinerRole);
  const explanation = domainJoin === "off" ? OFF_EXPLANATION : HELD_EXPLANATION;

  const isLocked = (value: DomainJoinSetting) =>
    planLocked && value !== "off" && value !== domainJoin;

  const parsedDomains = splitDomains(domains);

  // A live connection admits people whatever the domain door says, and they land on this seat
  // too, so the choice stays offered while the door is shut as long as that other door is open.
  // When neither is open the seat is not shown, and a choice the reader can no longer see is
  // never sent: the save carries no seat and the server keeps the one in force. Sending the seat
  // this card loaded would overwrite what another administrator saved since.
  const seatShown = selected !== "off" || ssoLive;
  const seatToSave = seatShown ? seat : void 0;

  const unchanged =
    selected === domainJoin &&
    parsedDomains.join(",") === joinDomains.join(",") &&
    (seatToSave === void 0 || seatToSave === joinerRole);

  return (
    <SettingsCard
      title="Joining your organization"
      hint="Choose how people can join without an invitation."
      badge={planLocked ? <EnterprisePlanBadge data-testid="join-policy-plan-badge" /> : undefined}
      actions={
        <Button
          size="sm"
          colorPalette="orange"
          loading={saving}
          disabled={unchanged || isLocked(selected)}
          onClick={() =>
            onSave({
              domainJoin: selected,
              domains: parsedDomains,
              ...(seatToSave === void 0 ? {} : { joinerRole: seatToSave }),
            })
          }
        >
          Save
        </Button>
      }
      data-testid="join-policy-card"
    >
      {planLocked && (
        <HStack gap={2} align="start" data-testid="join-policy-notice">
          <Box color="fg.muted" marginTop="1px" flexShrink={0}>
            <Lock size={14} />
          </Box>
          <Text color="fg.muted" fontSize="xs" lineHeight="1.55">
            {explanation}{" "}
            <Link href={planLink.href} colorPalette="orange" color="colorPalette.fg">
              {planLink.label}
            </Link>
          </Text>
        </HStack>
      )}

      <RadioGroup.Root
        value={selected}
        colorPalette="orange"
        onValueChange={(event) =>
          setSelected(OPTIONS.find((option) => option.value === event.value)?.value ?? "request")
        }
      >
        <VStack align="stretch" gap={3}>
          {OPTIONS.map((option) => (
            // The tooltip hangs off a wrapper: a disabled radio takes no pointer events.
            <Tooltip key={option.value} content={explanation} disabled={!isLocked(option.value)}>
              <Box>
                <RadioGroup.Item
                  value={option.value}
                  disabled={saving || isLocked(option.value)}
                  paddingX={2.5}
                  paddingY={2}
                  borderWidth="1px"
                  borderColor="border.muted"
                  borderRadius="md"
                  background="bg.panel"
                  transition="background 0.15s ease, border-color 0.15s ease"
                  _checked={{
                    borderColor: "colorPalette.solid",
                    background: "colorPalette.subtle",
                  }}
                  _hover={{ borderColor: "border.emphasized" }}
                >
                  <RadioGroup.ItemHiddenInput data-testid={`join-policy-${option.value}`} />
                  <RadioGroup.ItemIndicator />
                  <RadioGroup.ItemText>
                    <VStack align="start" gap={0}>
                      <Text fontSize="13px" fontWeight="500" lineHeight="1.4">
                        {option.label}
                      </Text>
                      <Text color="fg.muted" fontSize="xs" lineHeight="1.5">
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
            Verified domains
          </Text>
          <Input
            value={domains}
            placeholder="acme.com"
            disabled={isLocked("auto")}
            onChange={(event) => setDomains(event.target.value)}
            data-testid="join-policy-domains"
          />
          <Text color="fg.muted" fontSize="xs">
            Separate domains with commas. Each domain must be verified by your organization.
          </Text>
        </VStack>
      )}

      {seatShown && <JoinerSeatOptions seat={seat} saving={saving} onSelect={setSeat} />}

      {ssoLive && (
        <Text color="fg.subtle" fontSize="xs">
          Whether people signing in through your identity provider are admitted is the connection's
          own setting, on{" "}
          <Link
            href="/settings/authentication/provider"
            colorPalette="orange"
            color="colorPalette.fg"
          >
            Identity provider
          </Link>
          . Those admitted land on the seat chosen above.
        </Text>
      )}
    </SettingsCard>
  );
}
