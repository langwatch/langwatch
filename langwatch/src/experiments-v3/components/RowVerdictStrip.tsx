import { Badge, Box, HStack, Popover, Text } from "@chakra-ui/react";

/**
 * Per-row pairwise verdict strip (#5100). Rendered below each row in
 * the EvaluationsV3 table when a pairwise evaluator is configured.
 *
 * Shows the winner's display label (the user's variantA or variantB
 * id, or "Tie") with the judge reasoning available in a popover.
 *
 * Caller is responsible for resolving `label` -> human display name
 * (e.g. "A" -> the variantA TargetConfig's name).
 */
export type RowVerdictStripProps = {
  /** "A", "B", or "tie" — the verdict label from the pairwise evaluator. */
  label: "A" | "B" | "tie";
  /** Human-readable variant A name (typically the TargetConfig id). */
  variantAName: string;
  /** Human-readable variant B name. */
  variantBName: string;
  /** Judge reasoning text. */
  reasoning?: string;
};

const COLOR_BY_LABEL: Record<RowVerdictStripProps["label"], string> = {
  A: "green",
  B: "blue",
  tie: "gray",
};

export function RowVerdictStrip({
  label,
  variantAName,
  variantBName,
  reasoning,
}: RowVerdictStripProps) {
  const winnerName =
    label === "tie"
      ? "Tie"
      : label === "A"
        ? variantAName
        : variantBName;
  const color = COLOR_BY_LABEL[label];

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
      <Badge colorPalette={color} variant="subtle">
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
