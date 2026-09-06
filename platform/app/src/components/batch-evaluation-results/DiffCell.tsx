/**
 * DiffCell - Component for displaying multiple run values in comparison mode
 *
 * Shows stacked values with colored indicators to correlate with each run.
 */
import { Box, Circle, HStack, Text, VStack } from "@chakra-ui/react";

export type DiffValue = {
  runId: string;
  color: string;
  value: React.ReactNode;
  isLoading?: boolean;
};

type DiffCellProps = {
  values: DiffValue[];
  /** If true, values are displayed inline (horizontal) */
  inline?: boolean;
};

/**
 * Displays multiple values from different runs stacked vertically
 * with a small colored circle to indicate which run each value belongs to.
 */
export const DiffCell = ({ values, inline = false }: DiffCellProps) => {
  if (values.length === 0) {
    return (
      <Text fontSize="13px" color="fg.subtle">
        -
      </Text>
    );
  }

  // Single value - no need for indicator
  if (values.length === 1 && values[0]) {
    return <>{values[0].value}</>;
  }

  const Container = inline ? HStack : VStack;

  return (
    <Container
      align={inline ? "center" : "stretch"}
      gap={inline ? 4 : 2}
      width="100%"
    >
      {values.map((item, idx) => (
        <HStack
          key={item.runId}
          gap={2}
          width="100%"
          align="start"
          paddingY={idx > 0 ? 2 : 0}
          borderTop={!inline && idx > 0 ? "1px dashed" : undefined}
          borderColor="border"
        >
          <Circle size="8px" bg={item.color} flexShrink={0} marginTop="6px" />
          <Box flex={1} minWidth={0}>
            {item.value}
          </Box>
        </HStack>
      ))}
    </Container>
  );
};

/**
 * Simple colored indicator for run identification
 */
export const RunIndicator = ({ color }: { color: string }) => (
  <Circle size="8px" bg={color} flexShrink={0} />
);
