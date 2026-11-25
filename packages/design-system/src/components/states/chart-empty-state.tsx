import { Center, Text, VStack } from "@chakra-ui/react";
import { ChartNoAxesColumn } from "lucide-react";
import type { ReactNode } from "react";

export interface ChartEmptyStateProps {
  /** Defaults to "No data for this period". */
  title?: string;
  /** One sentence on why, or what widens the result: "Try a longer time range." */
  description?: string;
  icon?: ReactNode;
  /** The chart's height, when the parent does not give one. Fills the parent by default. */
  height?: string | number;
  testId?: string;
}

/** A chart with nothing to plot: fills the chart's own box and centres a quiet note. */
export function ChartEmptyState({
  title = "No data for this period",
  description,
  icon = <ChartNoAxesColumn size={20} aria-hidden />,
  height = "full",
  testId,
}: ChartEmptyStateProps) {
  return (
    <Center width="full" height={height} minHeight="120px" padding={4} data-testid={testId}>
      <VStack gap={1.5} textAlign="center" maxWidth="320px">
        <Center color="fg.subtle">{icon}</Center>
        <Text textStyle="sm" fontWeight="medium" color="fg.muted">
          {title}
        </Text>
        {description && (
          <Text textStyle="xs" color="fg.subtle" textWrap="balance">
            {description}
          </Text>
        )}
      </VStack>
    </Center>
  );
}
