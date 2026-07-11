/**
 * Scenario capability card (`platform_*_scenario(s)`, `platform_*_suite(s)`,
 * `platform_*_simulation_run(s)` reads).
 *
 * Renders a scenario / simulation result — its verdict or status plus a short
 * summary — and links into Simulations. Read-only.
 */
import { Badge, HStack, Text, VStack } from "@chakra-ui/react";
import {
  extractResourceName,
  extractToolText,
  summaryLines,
  type CapabilityCardInput,
} from "./capabilityRegistry";
import { LangyCapabilityCard } from "./LangyCapabilityCard";

function parseVerdict(output: unknown): string | null {
  const text = extractToolText(output);
  const verdict = text.match(/\b(passed|failed|success|error|running|pending|completed)\b/i);
  return verdict ? verdict[1]! : null;
}

export function LangyScenarioCard({
  descriptor,
  input,
  output,
  projectSlug,
}: CapabilityCardInput) {
  const name = extractResourceName(input, output);
  const verdict = parseVerdict(output);
  const failed = verdict ? /fail|error/i.test(verdict) : false;
  const lines = summaryLines(output, 2);

  return (
    <LangyCapabilityCard
      tone="read"
      surface="simulations"
      overline={descriptor.overline}
      title={
        <HStack gap={2} align="center">
          <Text textStyle="sm" fontWeight="640" color="fg" truncate>
            {name ?? "Scenario"}
          </Text>
          {verdict ? (
            <Badge
              size="sm"
              variant="subtle"
              colorPalette={failed ? "red" : "green"}
            >
              {verdict}
            </Badge>
          ) : null}
        </HStack>
      }
      projectSlug={projectSlug}
    >
      {lines.length > 0 ? (
        <VStack align="stretch" gap={0.5}>
          {lines.map((line, i) => (
            <Text key={i} textStyle="xs" color="fg.muted" lineHeight="1.45">
              {line}
            </Text>
          ))}
        </VStack>
      ) : null}
    </LangyCapabilityCard>
  );
}
