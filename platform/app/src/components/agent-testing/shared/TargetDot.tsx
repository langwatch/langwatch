/**
 * The mark of one target of a comparison: its colour as a dot, and its name
 * beside it when asked for.
 *
 * The same dot reads on the run dialog rows, on the column headers of the
 * comparison table, on the grid sections, in the run settings and in the runs
 * rail, so one target reads in one colour everywhere.
 *
 * @see specs/features/agent-testing/comparison-mode.feature
 */

import { Box, HStack, Text } from "@chakra-ui/react";

export function TargetDot({
  color,
  testId = "target-dot",
  marginTop,
}: {
  color: string;
  testId?: string;
  /** Where the dot sits against a label of more than one line. */
  marginTop?: string;
}) {
  return (
    <Box
      boxSize="8px"
      borderRadius="full"
      flexShrink={0}
      marginTop={marginTop}
      backgroundColor={color}
      data-testid={testId}
    />
  );
}

export function TargetLegend({
  color,
  label,
  fontSize = "12px",
  testId,
  isWrapped = false,
}: {
  color: string;
  label: string;
  fontSize?: string;
  testId?: string;
  /**
   * Whether a label too long for the space wraps to a second line. Cut short
   * by default, which is what a row of a rail wants; a column header asks for
   * the whole name, because a cut name is what the reader picks a column by.
   */
  isWrapped?: boolean;
}) {
  return (
    <HStack gap={1.5} minWidth={0} alignItems="flex-start" data-testid={testId}>
      <TargetDot color={color} marginTop={isWrapped ? "5px" : undefined} />
      <Text
        fontSize={fontSize}
        fontWeight="semibold"
        truncate={!isWrapped}
        whiteSpace={isWrapped ? "normal" : undefined}
        wordBreak={isWrapped ? "break-word" : undefined}
      >
        {label}
      </Text>
    </HStack>
  );
}
