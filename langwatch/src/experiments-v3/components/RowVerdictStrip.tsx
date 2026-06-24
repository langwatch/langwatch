import { Badge, Box, HStack, Popover, Text } from "@chakra-ui/react";

/**
 * Per-row pairwise / N-way verdict strip (#5100, #5101). Rendered
 * below each row in the EvaluationsV3 table when a pairwise evaluator
 * is configured.
 *
 * Shows the winning variant's display name (or "Tie") with the judge
 * reasoning available in a popover. The caller passes the resolved
 * winner display name directly — this component knows nothing about
 * the underlying variants array, slot labels, or evaluator mode.
 */
export type RowVerdictStripProps = {
  /**
   * Display name of the winning variant, or "Tie" when the verdict
   * was a tie. Caller resolves the raw label (whether "A"/"B" in
   * pairwise mode or a target id in select_best mode) to a name.
   */
  winnerName: string;
  /** True when the verdict was a tie. */
  isTie: boolean;
  /** Judge reasoning text. */
  reasoning?: string;
};

export function RowVerdictStrip({
  winnerName,
  isTie,
  reasoning,
}: RowVerdictStripProps) {
  return (
    <HStack
      paddingX={3}
      paddingY={1}
      borderTop="1px solid"
      borderColor="border.muted"
      bg="bg.subtle"
      fontSize="xs"
      gap={2}
    >
      <Text color="fg.muted">Pairwise verdict:</Text>
      <Badge colorPalette={isTie ? "gray" : "green"} variant="subtle">
        {winnerName}
      </Badge>
      {reasoning ? (
        <Popover.Root>
          <Popover.Trigger asChild>
            <Box as="button" color="fg.muted" textDecoration="underline">
              why?
            </Box>
          </Popover.Trigger>
          <Popover.Positioner>
            <Popover.Content maxWidth="400px">
              <Popover.Arrow />
              <Popover.Body fontSize="xs" whiteSpace="pre-wrap">
                {reasoning}
              </Popover.Body>
            </Popover.Content>
          </Popover.Positioner>
        </Popover.Root>
      ) : null}
    </HStack>
  );
}
