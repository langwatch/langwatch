import { RadioGroup } from "@chakra-ui/react";
import { Link } from "@langwatch/browser-host/link";
/**
 * How people join without an invitation. Opening policies need the Enterprise plan; the saved
 * setting stays selectable after a lapse so it can always be closed.
 * Spec: specs/identity/domain-auto-join.feature
 */
import { Box, Button, HStack, Input, Text, VStack } from "@langwatch/design-system/primitives";
import { SettingsCard } from "@langwatch/design-system/settings-card";
import { Tooltip } from "@langwatch/design-system/tooltip";
import type { DomainJoinSetting } from "@langwatch/identity-contract";
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
  saving,
  planLocked,
  planLink,
  onSave,
  ssoLive = false,
}: {
  domainJoin: DomainJoinSetting;
  joinDomains: string[];
  saving: boolean;
  planLocked: boolean;
  planLink: { href: string; label: string };
  onSave: (next: { domainJoin: DomainJoinSetting; domains: string[] }) => void;
  /** A connection routes sign-ins, so the card points at its own setting. */
  ssoLive?: boolean;
}) {
  const [selected, setSelected] = useState<DomainJoinSetting>(domainJoin);
  const [domains, setDomains] = useState(joinDomains.join(", "));
  const explanation = domainJoin === "off" ? OFF_EXPLANATION : HELD_EXPLANATION;

  const isLocked = (value: DomainJoinSetting) =>
    planLocked && value !== "off" && value !== domainJoin;

  const parsedDomains = splitDomains(domains);
  const unchanged = selected === domainJoin && parsedDomains.join(",") === joinDomains.join(",");

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
          onClick={() => onSave({ domainJoin: selected, domains: parsedDomains })}
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

      {ssoLive && (
        <Text color="fg.subtle" fontSize="xs">
          People signing in through your identity provider are answered by the connection's own
          setting, on{" "}
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
