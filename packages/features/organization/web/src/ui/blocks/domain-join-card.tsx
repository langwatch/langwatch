import { Button, Card, Heading, HStack, Input, RadioGroup, Text, VStack } from "@chakra-ui/react";
import type { DomainJoinSetting } from "@langwatch/identity-contract";
import { useState } from "react";

/**
 * How colleagues on a matching domain get in (D12).
 *
 * Three settings and no fourth. The copy says what each one does FOR the
 * reader and never how it is built — no "domain matcher", no "identifier
 * projection" — and the automatic option names its own cost in the same
 * breath as its benefit, because somebody walking in with nobody in the loop
 * is a thing an administrator should agree to on purpose.
 */
const OPTIONS: Array<{
  value: DomainJoinSetting;
  label: string;
  help: string;
}> = [
  {
    value: "off",
    label: "Nobody",
    help: "Your organization is not offered to colleagues, and nobody can ask to join it. Invitations still work.",
  },
  {
    value: "request",
    label: "Anyone who asks, once you approve",
    help: "Colleagues with a verified address on your domain can ask to join. You approve or reject each one.",
  },
  {
    value: "auto",
    label: "Anyone on a domain you name, straight away",
    help: "Colleagues with a verified address on that domain join with your default role, without anybody approving. You are emailed each time.",
  },
];

export function DomainJoinCard({
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

  const parsedDomains = domains
    .split(",")
    .map((domain) => domain.trim())
    .filter(Boolean);
  const unchanged = selected === domainJoin && parsedDomains.join(",") === joinDomains.join(",");

  return (
    <Card.Root width="full" data-testid="domain-join-card">
      <Card.Body>
        <VStack align="stretch" gap={4}>
          <VStack align="start" gap={1}>
            <Heading as="h3" size="sm">
              Who can join your organization
            </Heading>
            <Text color="fg.muted" fontSize="sm">
              Colleagues who verify an address on your company domain can find you instead of
              starting a workspace of their own.
            </Text>
          </VStack>

          <RadioGroup.Root
            value={selected}
            onValueChange={(event) => setSelected((event.value ?? "request") as DomainJoinSetting)}
          >
            <VStack align="stretch" gap={3}>
              {OPTIONS.map((option) => (
                <RadioGroup.Item key={option.value} value={option.value}>
                  <RadioGroup.ItemHiddenInput />
                  <RadioGroup.ItemIndicator />
                  <RadioGroup.ItemText>
                    <VStack align="start" gap={0}>
                      <Text>{option.label}</Text>
                      <Text color="fg.muted" fontSize="sm">
                        {option.help}
                      </Text>
                    </VStack>
                  </RadioGroup.ItemText>
                </RadioGroup.Item>
              ))}
            </VStack>
          </RadioGroup.Root>

          {selected === "auto" && (
            <VStack align="stretch" gap={1}>
              <Text fontSize="sm">Which domains, separated by commas</Text>
              <Input
                value={domains}
                placeholder="acme.com"
                onChange={(event) => setDomains(event.target.value)}
                data-testid="domain-join-domains"
              />
              <Text color="fg.muted" fontSize="sm">
                Company domains only, and at least two of your members must have verified an address
                on one before it can be used.
              </Text>
            </VStack>
          )}

          <HStack justifyContent="flex-end">
            <Button
              colorPalette="orange"
              loading={saving}
              disabled={unchanged}
              onClick={() => onSave({ domainJoin: selected, domains: parsedDomains })}
            >
              Save
            </Button>
          </HStack>
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}
