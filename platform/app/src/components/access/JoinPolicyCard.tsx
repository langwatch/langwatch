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
import { useEnterpriseLock } from "./useEnterpriseLock";

/**
 * Choose how people join without an invitation (D12).
 *
 * Opening policies require Enterprise. The saved policy remains selectable
 * after a plan lapse so an administrator can always close it; the service also
 * enforces that rule when the setting is saved.
 */
const OPTIONS: Array<{
  value: DomainJoinSetting;
  label: string;
  help: string;
}> = [
  {
    value: "off",
    label: "Invite only",
    help: "Only people with an invitation can join.",
  },
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

/** The comma-separated field, as the list of domains it means. */
function splitDomains(value: string): string[] {
  return value
    .split(",")
    .map((domain) => domain.trim())
    .filter(Boolean);
}

/**
 * Whether the plan still carries this control, and what to say when it does not.
 *
 * Two different sentences on purpose. An organization that never had it is
 * being offered something; one whose plan lapsed WHILE the door was open needs
 * to know their setting still stands and that closing it is always available —
 * only reopening needs the plan back.
 */
function useJoinPolicyLock(domainJoin: DomainJoinSetting) {
  return useEnterpriseLock({
    held: domainJoin !== "off",
    offExplanation:
      "Choosing who can join without an invitation is part of the Enterprise plan. You can still invite people by email on any plan.",
    heldExplanation:
      "Your plan no longer includes this control. Your current setting is still in force, and you can close the door at any time — reopening it needs the Enterprise plan.",
  });
}

function JoinPolicyOptions({
  selected,
  saving,
  lock,
  isLocked,
  onSelect,
}: {
  selected: DomainJoinSetting;
  saving: boolean;
  lock: ReturnType<typeof useJoinPolicyLock>;
  isLocked: (value: DomainJoinSetting) => boolean;
  onSelect: (value: DomainJoinSetting) => void;
}) {
  return (
    <RadioGroup.Root
      value={selected}
      colorPalette="orange"
      onValueChange={(event) =>
        onSelect((event.value ?? "request") as DomainJoinSetting)
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
  );
}

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
  const lock = useJoinPolicyLock(domainJoin);

  /**
   * An option this organization cannot move to. Closing the door is free, and
   * the setting already saved stays selectable so nobody is stranded on a
   * radio they cannot re-select after glancing at another.
   */
  const isLocked = (value: DomainJoinSetting) =>
    lock.locked && value !== "off" && value !== domainJoin;

  const parsedDomains = splitDomains(domains);
  const unchanged =
    selected === domainJoin &&
    parsedDomains.join(",") === joinDomains.join(",");

  return (
    <SettingsCard
      title="Joining your organization"
      // WHICH PEOPLE THIS IS ABOUT, and it is the half a reader guesses at:
      // where a connection is live for a domain, its own provisioning is the
      // way in and this is deliberately not offered beside it. So this governs
      // exactly the arrivals single sign-on does not catch — one clause,
      // because the reader came to move a radio and not to read a page.
      hint="Choose how people can join without an invitation."
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
      {lock.locked && <JoinPolicyLockNotice lock={lock} />}

      <JoinPolicyOptions
        selected={selected}
        saving={saving}
        lock={lock}
        isLocked={isLocked}
        onSelect={setSelected}
      />

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
          {/* What opens this door is the same verification ceremony
              sign-in routing uses — never a count of who happens to
              receive mail on the domain. */}
          <Text color="fg.muted" fontSize="11.5px">
            Separate domains with commas. Each domain must be verified by your
            organization.
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

/**
 * Why the control is locked, and the way out of it.
 *
 * THE WAY OUT IS THE BRAND COLOUR, NOT A SECOND BLUE. This link used to wear
 * `blue.600`, a colour nothing else on these pages speaks; the way to a plan
 * is an action, and actions here are orange.
 */
function JoinPolicyLockNotice({
  lock,
}: {
  lock: ReturnType<typeof useJoinPolicyLock>;
}) {
  return (
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
  );
}
