import {
  Box,
  Button,
  Card,
  Heading,
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
import { Tooltip } from "~/components/ui/tooltip";
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
 */
const OPTIONS: Array<{
  value: DomainJoinSetting;
  label: string;
  help: string;
}> = [
  {
    value: "off",
    label: "Nobody",
    help: "Invitations still work.",
  },
  {
    value: "request",
    label: "They ask, you approve",
    help: "On a verified address at your domain.",
  },
  {
    value: "auto",
    // The one option somebody should agree to on purpose, so it names its own
    // cost in its own label rather than three lines below it.
    label: "Straight in, nobody approves",
    help: "On a domain you verified. You are emailed each time.",
  },
];

export function JoinPolicyCard({
  domainJoin,
  joinDomains,
  saving,
  onSave,
}: {
  domainJoin: DomainJoinSetting;
  joinDomains: string[];
  saving: boolean;
  onSave: (next: { domainJoin: DomainJoinSetting; domains: string[] }) => void;
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
    <Card.Root width="full" data-testid="join-policy-card">
      <Card.Body>
        <VStack align="stretch" gap={4}>
          <VStack align="start" gap={1}>
            <HStack gap={2}>
              <Heading as="h3" size="sm">
                Who can join your organization
              </Heading>
              {lock.locked && (
                <EnterprisePlanBadge data-testid="join-policy-plan-badge" />
              )}
            </HStack>
            {/* WHICH PEOPLE THIS IS ABOUT, and it is the half a reader
                guesses at: where a connection is live for a domain, its own
                provisioning is the way in and this is deliberately not offered
                beside it. So this governs exactly the arrivals single sign-on
                does not catch — one clause, because the reader came to move a
                radio and not to read a page. */}
            <Text color="fg.muted" fontSize="sm">
              For colleagues who arrive without single sign-on.
            </Text>
            {lock.locked && (
              <HStack gap={2} paddingTop={1} data-testid="join-policy-notice">
                <Box color="fg.muted">
                  <Lock size={14} />
                </Box>
                <Text color="fg.muted" fontSize="sm">
                  {lock.explanation}{" "}
                  <Link href={lock.linkHref} fontSize="sm" color="blue.600">
                    {lock.linkLabel}
                  </Link>
                </Text>
              </HStack>
            )}
          </VStack>

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
                          <Text fontSize="sm" fontWeight="medium">
                            {option.label}
                          </Text>
                          <Text color="fg.muted" fontSize="xs">
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
              <Text fontSize="sm">Which domains, separated by commas</Text>
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
              <Text color="fg.muted" fontSize="sm">
                Each must be verified as yours first.
              </Text>
            </VStack>
          )}

          <HStack justifyContent="flex-end">
            <Button
              colorPalette="orange"
              loading={saving}
              disabled={unchanged || isLocked(selected)}
              onClick={() =>
                onSave({ domainJoin: selected, domains: parsedDomains })
              }
            >
              Save
            </Button>
          </HStack>
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}
