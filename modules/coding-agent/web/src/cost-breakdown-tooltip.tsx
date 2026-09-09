import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { formatCost } from "@langwatch/design-system/display-formatters";

/**
 * The cost breakdown behind a cost value: what was really billed, what a
 * bundled plan carried, and the list-price total of the two.
 *
 * The package's own copy of the trace explorer's tooltip content, taken rather
 * than imported because it lives under `platform/app`'s `features/traces-v2`
 * and a feature-web package may not reach in. `formatCost` is the shared one,
 * so the numbers still read identically in both places.
 */
function TooltipRow({ label, value }: { label: string; value: string }) {
  return (
    <HStack justify="space-between" gap={4} align="flex-start" minWidth={0}>
      <Text textStyle="xs" color="fg.muted" flexShrink={0}>
        {label}
      </Text>
      <Text
        textStyle="xs"
        color="fg"
        textAlign="right"
        wordBreak="break-all"
        whiteSpace="nowrap"
        textOverflow="ellipsis"
        overflow="hidden"
      >
        {value}
      </Text>
    </HStack>
  );
}

export function CostBreakdownTooltipContent({
  isBundled,
  billedCost,
  nonBilledCost,
  grandCost,
  tokensEstimated,
  estimatedNote,
}: {
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
  /** Non-bundled only: surface the "estimated from token counts" caveat. */
  estimatedNote?: boolean;
}) {
  return (
    <VStack align="stretch" gap={0.5} minWidth="160px">
      {isBundled ? (
        <>
          <TooltipRow label="Billed" value={formatCost(billedCost)} />
          <TooltipRow label="Non-billed" value={formatCost(nonBilledCost)} />
          <Box height="1px" bg="border" marginY={1} />
          <TooltipRow label="Theoretical total" value={formatCost(grandCost, tokensEstimated)} />
          <Text textStyle="2xs" color="fg.muted" paddingTop={1}>
            Bundled plan, not billed per token
          </Text>
        </>
      ) : (
        <>
          <TooltipRow label="Total" value={formatCost(grandCost, tokensEstimated)} />
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
