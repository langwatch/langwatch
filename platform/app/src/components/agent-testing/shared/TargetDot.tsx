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
}: {
  color: string;
  testId?: string;
}) {
  return (
    <Box
      boxSize="8px"
      borderRadius="full"
      flexShrink={0}
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
}: {
  color: string;
  label: string;
  fontSize?: string;
  testId?: string;
}) {
  return (
    <HStack gap={1.5} minWidth={0} data-testid={testId}>
      <TargetDot color={color} />
      <Text fontSize={fontSize} fontWeight="semibold" truncate>
        {label}
      </Text>
    </HStack>
  );
}
