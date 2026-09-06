import { Box, Text, VStack } from "@chakra-ui/react";
import { formatCost } from "../../utils/formatters";
import { TooltipRow } from "./TooltipRow";

interface CostBreakdownTooltipContentProps {
  /** Bundled = the LLM cost is not billed per token (e.g. Claude Max). */
  isBundled: boolean;
  /** Cost actually billed per token (real spend). */
  billedCost: number;
  /** Bundled / theoretical portion not billed per token. */
  nonBilledCost: number;
  /** Grand list-price cost (billed + non-billed). */
  grandCost: number;
  /** Appends a `*` to the cost when it was derived from token estimates. */
  tokensEstimated?: boolean;
  /**
   * Non-bundled only: surface the "estimated from token counts" caveat. The
   * drawer passes this when the trace has no authoritative cost; the list omits
   * it (the `*` on the value already signals estimation there).
   */
  estimatedNote?: boolean;
}

/**
 * The cost breakdown shown in the trace-details cost pill tooltip, shared so
 * the trace list's bundled cost cell surfaces the same billed / non-billed /
 * theoretical split instead of a flat one-line title.
 */
export function CostBreakdownTooltipContent({
  isBundled,
  billedCost,
  nonBilledCost,
  grandCost,
  tokensEstimated,
  estimatedNote,
}: CostBreakdownTooltipContentProps) {
  return (
    <VStack align="stretch" gap={0.5} minWidth="160px">
      {isBundled ? (
        <>
          <TooltipRow label="Billed" value={formatCost(billedCost)} />
          <TooltipRow label="Non-billed" value={formatCost(nonBilledCost)} />
          <Box height="1px" bg="border" marginY={1} />
          <TooltipRow
            label="Theoretical total"
            value={formatCost(grandCost, tokensEstimated)}
          />
          <Text textStyle="2xs" color="fg.muted" paddingTop={1}>
            Bundled plan, not billed per token
          </Text>
        </>
      ) : (
        <>
          <TooltipRow
            label="Total"
            value={formatCost(grandCost, tokensEstimated)}
          />
          {estimatedNote && (
            <Text textStyle="2xs" color="fg.muted" paddingTop={1}>
              Cost is estimated from token counts
            </Text>
          )}
        </>
      )}
    </VStack>
  );
}
