import { Box, HStack, Icon, Popover, Text } from "@chakra-ui/react";
import { Equal, Trophy } from "lucide-react";

/**
 * Per-row pairwise verdict strip (#5100). Rendered below each row in
 * the EvaluationsV3 table when a pairwise evaluator is configured.
 *
 * Shows the winning variant by name (with a trophy) and the loser by
 * name (struck through), or a tie indicator. Judge reasoning is
 * surfaced via a "why?" popover.
 */
export type RowVerdictStripProps = {
  /**
   * Slot-letter form of the verdict ("A", "B", or "tie"). The pairwise
   * evaluator's stored label is now the winner's candidate id under the
   * Option C contract, so callers must normalize via
   * `normalizePairwiseLabel` before rendering. `PairwiseVerdictRow` is
   * the production caller and does this; tests and preview stories can
   * pass slot letters directly.
   */
  label: "A" | "B" | "tie";
  /** Human-readable variant A name (typically the TargetConfig id). */
  variantAName: string;
  /** Human-readable variant B name. */
  variantBName: string;
  /** Judge reasoning text. */
  reasoning?: string;
};

export function RowVerdictStrip({
  label,
  variantAName,
  variantBName,
  reasoning,
}: RowVerdictStripProps) {
  const isTie = label === "tie";
  const winnerName = label === "A" ? variantAName : variantBName;
  const loserName = label === "A" ? variantBName : variantAName;

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
      {isTie ? (
        <HStack gap={1.5}>
          <Icon as={Equal} color="fg.muted" boxSize="14px" />
          <Text fontWeight="medium">Tie</Text>
        </HStack>
      ) : (
        <HStack gap={1.5}>
          <Icon as={Trophy} color="yellow.fg" boxSize="14px" />
          <Text fontWeight="medium" color="green.fg">
            {winnerName}
          </Text>
          <Text color="fg.muted">vs {loserName}</Text>
        </HStack>
      )}
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
