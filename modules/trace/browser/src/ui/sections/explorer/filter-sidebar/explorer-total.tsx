import { Text } from "@chakra-ui/react";
import type React from "react";

import { useExplorerCounts } from "../hooks/use-explorer-counts.ts";

/**
 * The sidebar's total: the same number the pagination line shows, from the
 * same read (`useExplorerCounts`).
 */
export const ExplorerTotal: React.FC = () => {
  const { summary, isLoading, isPlaceholderData } = useExplorerCounts();
  if (isLoading) return null;
  return (
    <Text
      data-testid="explorer-total"
      textStyle="xs"
      color="fg.subtle"
      fontVariantNumeric="tabular-nums"
      opacity={isPlaceholderData ? 0.5 : 1}
      transition="opacity 120ms ease"
    >
      {summary}
    </Text>
  );
};
