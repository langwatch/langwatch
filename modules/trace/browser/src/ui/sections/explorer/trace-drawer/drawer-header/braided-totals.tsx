import {
  formatCost,
  formatDuration,
  formatTokens,
} from "@langwatch/design-system/display-formatters";
import { Box, VStack } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import type { TraceBraidedSummary, TraceHeader } from "@langwatch/trace-contract";

import { joinOwnerNames } from "../../../../../model/braids/braided-span.ts";
import type { FittedChip } from "../../../../blocks/explorer/trace-drawer/fitted-chip-row.tsx";
import { TooltipRow } from "../../../../elements/explorer/shared/tooltip-row.tsx";
import { MetricPill } from "./metric-pill.tsx";

/**
 * The header's duration, spans, cost and tokens over the whole trace, braided
 * spans included, each saying how much is this project's (ADR-183 §5). Replaces
 * the project's own pills in place; the trace list keeps its own totals.
 */
export function withBraidedTotals({
  metrics,
  trace,
  braided,
}: {
  metrics: FittedChip[];
  trace: TraceHeader;
  braided: TraceBraidedSummary;
}): FittedChip[] {
  const totals = braidedTotalChips({ trace, braided });
  const replaced = metrics.map((chip) => totals.find((total) => total.id === chip.id) ?? chip);
  const added = totals.filter((total) => !metrics.some((chip) => chip.id === total.id));
  return [...replaced, ...added];
}

function braidedTotalChips({
  trace,
  braided,
}: {
  trace: TraceHeader;
  braided: TraceBraidedSummary;
}): FittedChip[] {
  const braidedLabel = `From ${joinOwnerNames(braided.owners.map((owner) => owner.name))}`;
  const chips: FittedChip[] = [
    {
      id: "duration",
      node: (
        <BraidedMetric
          label="Duration"
          value={formatDuration(braided.durationMs)}
          rows={[
            { label: "This project's spans", value: formatDuration(trace.durationMs) },
            { label: "Whole trace", value: formatDuration(braided.durationMs) },
          ]}
        />
      ),
    },
    {
      id: "spans",
      node: (
        <BraidedMetric
          label="Spans"
          value={braided.spanCount.toLocaleString()}
          rows={[
            { label: "This project", value: trace.spanCount.toLocaleString() },
            {
              label: braidedLabel,
              value: Math.max(0, braided.spanCount - trace.spanCount).toLocaleString(),
            },
          ]}
        />
      ),
    },
  ];
  const ownCost = trace.totalCost ?? 0;
  if (braided.cost != null && braided.cost > 0) {
    chips.push({
      id: "cost",
      node: (
        <BraidedMetric
          label="Cost"
          value={formatCost(braided.cost)}
          rows={[
            { label: "This project", value: formatCost(ownCost) },
            { label: braidedLabel, value: formatCost(Math.max(0, braided.cost - ownCost)) },
          ]}
        />
      ),
    });
  }
  if (braided.inputTokens != null && braided.outputTokens != null) {
    const ownIn = trace.inputTokens ?? 0;
    const ownOut = trace.outputTokens ?? 0;
    chips.push({
      id: "tokens",
      node: (
        <BraidedMetric
          label="Tokens"
          value={tokenPair({ input: braided.inputTokens, output: braided.outputTokens })}
          rows={[
            { label: "This project", value: tokenPair({ input: ownIn, output: ownOut }) },
            {
              label: braidedLabel,
              value: tokenPair({
                input: Math.max(0, braided.inputTokens - ownIn),
                output: Math.max(0, braided.outputTokens - ownOut),
              }),
            },
          ]}
        />
      ),
    });
  }
  return chips;
}

function tokenPair({ input, output }: { input: number; output: number }): string {
  return `${formatTokens(input)} in · ${formatTokens(output)} out`;
}

function BraidedMetric({
  label,
  value,
  rows,
}: {
  label: string;
  value: string;
  rows: { label: string; value: string }[];
}) {
  return (
    <Tooltip
      content={
        <VStack align="stretch" gap={1} minWidth="200px">
          {rows.map((row) => (
            <TooltipRow key={row.label} label={row.label} value={row.value} />
          ))}
        </VStack>
      }
      positioning={{ placement: "top" }}
    >
      <Box>
        <MetricPill label={label} value={value} />
      </Box>
    </Tooltip>
  );
}
