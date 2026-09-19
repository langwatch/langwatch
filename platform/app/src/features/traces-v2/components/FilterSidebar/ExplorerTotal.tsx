import { Text } from "@chakra-ui/react";
import type React from "react";
import { useExplorerCounts } from "../../hooks/useExplorerCounts";

/**
 * The sidebar's total: the same number the pagination line and the selection
 * header show, from the same read (`useExplorerCounts`).
 */
export const ExplorerTotal: React.FC = () => {
  const { totalHits, itemNoun, isLoading, isPlaceholderData } =
    useExplorerCounts();
  if (isLoading) return null;
  return (
    <Text
      data-testid="explorer-total"
      textStyle="xs"
      color="fg.subtle"
      fontVariantNumeric="tabular-nums"
      opacity={isPlaceholderData ? 0.5 : 1}
      transition="opacity 120ms ease"
      whiteSpace="nowrap"
    >
      {totalHits.toLocaleString()} {itemNoun}
    </Text>
  );
};
