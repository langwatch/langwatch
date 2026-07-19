/**
 * Evaluation-run capability card (`platform_run_experiment`, `platform_run_suite`,
 * `platform_experiment_results`, `platform_experiment_status`).
 *
 * Surfaces the outcome of a run — a status line plus any pass-rate / score the
 * result reports — and links through to the run. Read-only.
 */
import { Badge, HStack, Text, VStack } from "@chakra-ui/react";
import { useCapabilityData } from "../../hooks/useCapabilityData";
import {
  extractPrimaryId,
  extractToolText,
  summaryLines,
  type CapabilityCardInput,
} from "./capabilityRegistry";
import { LangyCapabilityCard } from "./LangyCapabilityCard";

function parseRun(output: unknown): {
  status: string | null;
  passRate: string | null;
} {
  const text = extractToolText(output);
  const status = text.match(
    /\b(completed|running|failed|queued|passed|finished)\b/i,
  );
  const passRate = text.match(/([\d.]+\s*%)\s*(?:pass|passed|pass rate)?/i);
  return {
    status: status ? status[1]! : null,
    passRate: passRate ? passRate[1]!.replace(/\s+/g, "") : null,
  };
}

export function LangyEvalRunCard({
  descriptor,
  input,
  output,
  digest,
  projectSlug,
}: CapabilityCardInput) {
  const id = digest?.primaryId ?? extractPrimaryId(input, output);
  const { status, passRate } = parseRun(output);
  const lines = summaryLines(output, 2);

  // Opportunistic: when the run references an experiment the viewer can read,
  // title the card by the experiment's CURRENT name. Anything else (no
  // hydrator, id not found) quietly keeps the parsed title below.
  const hydration = useCapabilityData({ digest: digest ?? null, maxRows: 1 });
  const hydratedName = hydration.rows[0]?.primary;

  return (
    <LangyCapabilityCard
      tone="read"
      surface={descriptor.surface}
      overline={descriptor.overline}
      title={
        <HStack gap={2} align="center">
          <Text textStyle="sm" fontWeight="640" color="fg">
            {hydratedName ??
              digest?.name ??
              (id ? `Run ${id.slice(0, 10)}` : "Run")}
          </Text>
          {status ? (
            <Badge size="sm" variant="subtle" colorPalette="orange">
              {status}
            </Badge>
          ) : null}
          {passRate ? (
            <Text
              textStyle="xs"
              fontFamily="mono"
              fontWeight="700"
              color="green.fg"
            >
              {passRate}
            </Text>
          ) : null}
        </HStack>
      }
      projectSlug={projectSlug}
      resourceId={id}
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
