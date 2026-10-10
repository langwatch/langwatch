import { Link } from "@langwatch/browser-host/link";
import { AccessState } from "@langwatch/design-system/access-state";
/**
 * How people join without an invitation. Opening policies need the Enterprise plan; the saved
 * setting stays selectable after a lapse so it can always be closed.
 * Spec: specs/identity/domain-auto-join.feature
 */
import { Box, Button, HStack, Input, Text, VStack } from "@langwatch/design-system/primitives";
import { RawRadioGroup as RadioGroup } from "@langwatch/design-system/radio";
import { SettingsCard } from "@langwatch/design-system/settings-card";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { DEFAULT_DOMAIN_JOIN_SETTING } from "@langwatch/identity-contract";
import type { DomainJoinSetting, JoinerRole } from "@langwatch/identity-contract";
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
 * The seat a newcomer lands on (ADR-171): a Member sees the shared projects, a
 * Developer gets a project of their own and nothing shared. It applies to
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

const OFF_EXPLANATION =
  "Choosing who can join without an invitation is part of the Enterprise plan. You can still invite people by email on any plan.";
const HELD_EXPLANATION =
  "Your plan no longer includes this control. Your current setting is still in force, and you can close the door at any time. Reopening it needs the Enterprise plan.";

const splitDomains = (value: string) =>
  value
    .split(",")
    .map((domain) => domain.trim())
    .filter(Boolean);

/** Which seat they land on. Shown whenever anybody can get in without an invitation. */
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
    <VStack
      align="stretch"
      gap={2}
      marginTop={2}
      paddingTop={4}
      borderTopWidth="1px"
      borderColor="border.muted"
    >
      <Text fontSize="13px" fontWeight="500">
        Seat for people who join
      </Text>
      <RadioGroup.Root
        value={seat}
        aria-label="Seat for people who join"
        size="sm"
        colorPalette="gray"
        onValueChange={(event) => onSelect((event.value ?? "MEMBER") as JoinerRole)}
      >
        <VStack align="stretch" gap={1}>
          {JOINER_SEAT_OPTIONS.map((option) => (
            <RadioGroup.Item
              key={option.value}
              value={option.value}
              disabled={saving}
              paddingY={1.5}
              alignItems="start"
            >
              <RadioGroup.ItemHiddenInput data-testid={`joiner-seat-${option.value}`} />
              <RadioGroup.ItemIndicator marginTop={0.5} />
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
  /** The seat people who join without an invitation receive (ADR-171). */
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
  const explanation =
    domainJoin === "off" || domainJoin === DEFAULT_DOMAIN_JOIN_SETTING
      ? OFF_EXPLANATION
      : HELD_EXPLANATION;

  const isLocked = (value: DomainJoinSetting) =>
    planLocked && value !== "off" && value !== domainJoin;

  const parsedDomains = splitDomains(domains);
  // A live connection admits people too and they land on this seat, so it
  // stays offered while that door is open. When neither door is open the seat
  // is hidden and never sent: the save would overwrite another admin's change.
  const seatShown = selected !== "off" || ssoLive;
  const seatToSave = seatShown ? seat : undefined;
  const unchanged =
    selected === domainJoin &&
    parsedDomains.join(",") === joinDomains.join(",") &&
    (seatToSave === undefined || seatToSave === joinerRole);

  return (
    <SettingsCard
      title="Joining your organization"
      hint="Choose how people can join without an invitation."
      badge={planLocked ? <EnterprisePlanBadge data-testid="join-policy-plan-badge" /> : undefined}
      actions={
        <HStack
          width="full"
          justify="flex-end"
          borderTopWidth="1px"
          borderColor="border.muted"
          paddingTop={3}
        >
          <Button
            size="sm"
            variant="outline"
            loading={saving}
            disabled={unchanged || isLocked(selected)}
            onClick={() =>
              onSave({
                domainJoin: selected,
                domains: parsedDomains,
                ...(seatToSave === undefined ? {} : { joinerRole: seatToSave }),
              })
            }
          >
            Save
          </Button>
        </HStack>
      }
      data-testid="join-policy-card"
    >
      {planLocked && (
        <AccessState
          kind="upgrade"
          compact
          title="Joining without an invitation requires Enterprise"
          description={explanation}
          data-testid="join-policy-notice"
          actions={
            <Button asChild size="sm" colorPalette="orange">
              <Link href={planLink.href}>{planLink.label}</Link>
            </Button>
          }
        />
      )}

      <RadioGroup.Root
        value={selected}
        aria-label="Joining your organization"
        size="sm"
        colorPalette="gray"
        onValueChange={(event) =>
          setSelected(OPTIONS.find((option) => option.value === event.value)?.value ?? "request")
        }
      >
        <VStack align="stretch" gap={1}>
          {OPTIONS.map((option) => (
            // The tooltip hangs off a wrapper: a disabled radio takes no pointer events.
            <Tooltip key={option.value} content={explanation} disabled={!isLocked(option.value)}>
              <Box width="full">
                <RadioGroup.Item
                  width="full"
                  value={option.value}
                  disabled={saving || isLocked(option.value)}
                  paddingY={1.5}
                  alignItems="start"
                >
                  <RadioGroup.ItemHiddenInput data-testid={`join-policy-${option.value}`} />
                  <RadioGroup.ItemIndicator marginTop={0.5} />
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
            size="sm"
            aria-label="Verified domains"
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
