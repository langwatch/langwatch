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

/**
 * Aggregate header bar for a pairwise / N-way evaluator run (#5100, #5101).
 *
 * Renders above the EvaluationsV3 table when at least one row has a
 * verdict. Shows the running tally per variant, the bias-correction
 * indicator, total judge cost, filter chips for the visible row
 * subset, and the export / promote handoff buttons.
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
  /** Promote a specific variant's prompt. Receives the variant id. */
  onPromote: (variantId: string) => void;
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
  onPromote,
  biasCorrected = true,
}: AggregateHeaderBarProps) {
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
            <Button
              key={v.id}
              size="xs"
              variant="ghost"
              onClick={() => onPromote(v.id)}
            >
              <Icon as={LuRocket} boxSize="14px" />
              Promote {v.name}
            </Button>
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
              <Popover.Content width="200px">
                <Popover.Arrow />
                <Popover.Body padding={1}>
                  <VStack align="stretch" gap={0}>
                    {variants.map((v) => (
                      <Button
                        key={v.id}
                        size="xs"
                        variant="ghost"
                        justifyContent="flex-start"
                        onClick={() => onPromote(v.id)}
                      >
                        <Icon as={LuRocket} boxSize="14px" />
                        {v.name}
                      </Button>
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
