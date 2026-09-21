/**
 * Scenario capability card (`platform_*_scenario(s)`, `platform_*_suite(s)`,
 * `platform_*_simulation_run(s)` reads).
 *
 * Renders a scenario / simulation result — its name plus its status — and links
 * into Simulations. Read-only.
 *
 * The status comes from the payload's own `status` field when it has one, and
 * only falls back to reading a verdict out of the result's PROSE. A scenario
 * `get` returns a structured document, and matching a verdict word against its
 * serialised form found whatever word happened to be in a criterion.
 *
 * Spec: specs/langy/langy-capability-cards.feature.
 */
import { Badge, HStack, Text, VStack } from "@chakra-ui/react";
import { extractPlatformUrl } from "~/utils/platformHref";
import {
  type CapabilityCardInput,
  extractPrimaryId,
  extractResourceName,
  extractToolText,
  isSerializedDocumentLine,
  summaryLines,
} from "./capabilityRegistry";
import { LangyCapabilityCard } from "./LangyCapabilityCard";

/** Keys a scenario or simulation run reports its state under. */
const STATUS_KEYS = ["status", "verdict", "result", "outcome", "state"];

function statusFromPayload(output: unknown): string | null {
  if (!output || typeof output !== "object") return null;
  const record = output as Record<string, unknown>;
  for (const key of STATUS_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/**
 * A verdict word in the result's prose. Only consulted when the result is text
 * — a serialised document is not prose, and reading one here is what put a
 * criterion's wording in the status badge.
 */
function verdictFromText(output: unknown): string | null {
  const text = extractToolText(output).trim();
  if (!text || isSerializedDocumentLine(text.split("\n")[0]!.trim())) {
    return null;
  }
  const verdict = text.match(
    /\b(passed|failed|success|error|running|pending|completed)\b/i,
  );
  return verdict ? verdict[1]! : null;
}

export function LangyScenarioCard({
  descriptor,
  input,
  output,
  projectSlug,
}: CapabilityCardInput) {
  const id = extractPrimaryId(input, output);
  const name = extractResourceName(input, output);
  const status = statusFromPayload(output) ?? verdictFromText(output);
  const failed = status ? /fail|error/i.test(status) : false;
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
          {status ? (
            <Badge
              size="sm"
              variant="subtle"
              colorPalette={failed ? "red" : "green"}
            >
              {status}
            </Badge>
          ) : null}
        </HStack>
      }
      projectSlug={projectSlug}
      resourceId={id}
      platformUrl={extractPlatformUrl(output)}
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
