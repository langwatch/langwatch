import {
  Box,
  Button,
  HStack,
  Icon,
  Popover,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { LuCheck, LuChevronDown, LuDownload, LuRocket } from "react-icons/lu";

import type { TargetConfig } from "../types";
import { PromoteWinnerButton } from "./PromoteWinnerButton";

/**
 * Aggregate header bar for a pairwise / N-way evaluator run (#5100, #5101).
 *
 * Renders above the EvaluationsV3 table when at least one row has a
 * verdict. Shows the running tally per variant, the bias-correction
 * indicator, total judge cost, filter chips for the visible row
 * subset, and the export / promote handoff buttons.
 *
 * Promote buttons are real (#5104): each renders a `PromoteWinnerButton`
 * that opens a confirmation modal and calls the existing prompts.assignTag
 * mutation. The header forwards eval context (evalId, experimentId, runId)
 * so the resulting tag assignment carries an audit trail back to the eval
 * that produced the decision.
 */

/**
 * Filter chip key: either the literal "all" / "ties" / "losses", or
 * a target id whose wins should be shown. Caller decides what each
 * filter means in context.
 */
export type AggregateFilter = "all" | "ties" | "losses" | { variantId: string };

export type VariantCount = {
  /** TargetConfig id; stable identifier. */
  id: string;
  /** Display name for the chip / tally line. */
  name: string;
  /** Number of rows this variant won. */
  wins: number;
  /**
   * Total rows judged where this variant was a contestant (wins + losses + ties
   * scoped to it). Used by PromoteWinnerButton to compute the verdict-summary
   * line; the header tally still derives only from wins/ties.
   */
  totalRows: number;
  /** 0..1 win rate. Used to gate the promote button at the threshold. */
  winRate: number;
  /** TargetConfig this variant maps to — PromoteWinnerButton reads promptId/version here. */
  target: TargetConfig;
};

export type AggregateHeaderBarProps = {
  /** Per-variant win counts, in display order. */
  variants: VariantCount[];
  /** Number of rows that ended in a tie. */
  ties: number;
  /** Total judge cost (sum of all per-row pairwise costs), in USD. */
  totalCost: number;
  /** Currently active filter chip. */
  activeFilter: AggregateFilter;
  onFilterChange: (next: AggregateFilter) => void;
  /** Markdown export handoff. */
  onExport: () => void;
  /**
   * Eval cell id that produced these verdicts. Passed to PromoteWinnerButton
   * so the resulting tag assignment carries an audit trail back here.
   */
  evalId: string;
  /** Experiment the eval ran in — same audit-trail use. */
  experimentId: string;
  /** Optional run id, for cross-run promote contexts. */
  runId?: string;
  /** Optional dataset name surfaced in the promote-confirm verdict line. */
  datasetName?: string;
  /** Override the default promote-threshold for this render (defaults inside PromoteWinnerButton). */
  winRateThreshold?: number;
  /** Set true when bias-correction was applied (swap_and_confirm or randomize_order). */
  biasCorrected?: boolean;
};

function filterEquals(a: AggregateFilter, b: AggregateFilter): boolean {
  if (typeof a === "string" && typeof b === "string") return a === b;
  if (typeof a === "object" && typeof b === "object")
    return a.variantId === b.variantId;
  return false;
}

export function AggregateHeaderBar({
  variants,
  ties,
  totalCost,
  activeFilter,
  onFilterChange,
  onExport,
  evalId,
  experimentId,
  runId,
  datasetName,
  winRateThreshold,
  biasCorrected = true,
}: AggregateHeaderBarProps) {
  const buildVerdictSummary = (v: VariantCount) => ({
    wins: v.wins,
    totalRows: v.totalRows,
    winRate: v.winRate,
    ...(datasetName ? { datasetName } : {}),
  });
  const tallyLine = [
    ...variants.map((v) => `${v.name} wins ${v.wins}`),
    `Ties ${ties}`,
  ].join(" · ");

  return (
    <HStack
      paddingX={3}
      paddingY={2}
      borderBottom="1px solid"
      borderColor="border.muted"
      bg="bg.subtle"
      fontSize="sm"
      gap={3}
      flexWrap="wrap"
    >
      <Text fontWeight="medium">{tallyLine}</Text>

      {biasCorrected ? (
        <HStack gap={1} color="green.fg" fontSize="xs">
          <Icon as={LuCheck} boxSize="14px" />
          <Text>Bias-corrected</Text>
        </HStack>
      ) : null}

      <Text fontSize="xs" color="fg.muted">
        Judge cost: ${totalCost.toFixed(4)}
      </Text>

      <Spacer />

      <HStack gap={1}>
        <Button
          size="xs"
          variant={filterEquals(activeFilter, "all") ? "solid" : "outline"}
          onClick={() => onFilterChange("all")}
        >
          All
        </Button>
        {variants.map((v) => (
          <Button
            key={v.id}
            size="xs"
            variant={
              filterEquals(activeFilter, { variantId: v.id })
                ? "solid"
                : "outline"
            }
            onClick={() => onFilterChange({ variantId: v.id })}
          >
            {v.name}
          </Button>
        ))}
        <Button
          size="xs"
          variant={filterEquals(activeFilter, "losses") ? "solid" : "outline"}
          onClick={() => onFilterChange("losses")}
        >
          Losses (regressions)
        </Button>
      </HStack>

      <Box width="1px" height="20px" bg="border.muted" />

      <HStack gap={1}>
        <Button size="xs" variant="ghost" onClick={onExport}>
          <Icon as={LuDownload} boxSize="14px" />
          Export
        </Button>
        {variants.length <= 2 ? (
          variants.map((v) => (
            <PromoteWinnerButton
              key={v.id}
              variantId={v.id}
              variantName={v.name}
              target={v.target}
              verdictSummary={buildVerdictSummary(v)}
              evalId={evalId}
              experimentId={experimentId}
              runId={runId}
              winRateThreshold={winRateThreshold}
              layout="named-button"
            />
          ))
        ) : (
          <Popover.Root>
            <Popover.Trigger asChild>
              <Button size="xs" variant="ghost">
                <Icon as={LuRocket} boxSize="14px" />
                Promote
                <Icon as={LuChevronDown} boxSize="12px" />
              </Button>
            </Popover.Trigger>
            <Popover.Positioner>
              <Popover.Content width="220px">
                <Popover.Arrow />
                <Popover.Body padding={1}>
                  <VStack align="stretch" gap={0}>
                    {variants.map((v) => (
                      <PromoteWinnerButton
                        key={v.id}
                        variantId={v.id}
                        variantName={v.name}
                        target={v.target}
                        verdictSummary={buildVerdictSummary(v)}
                        evalId={evalId}
                        experimentId={experimentId}
                        runId={runId}
                        winRateThreshold={winRateThreshold}
                        layout="menu-item"
                      />
                    ))}
                  </VStack>
                </Popover.Body>
              </Popover.Content>
            </Popover.Positioner>
          </Popover.Root>
        )}
      </HStack>
    </HStack>
  );
}
