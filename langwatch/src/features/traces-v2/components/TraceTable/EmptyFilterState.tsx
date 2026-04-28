import { Button, EmptyState, Flex, VStack } from "@chakra-ui/react";
import { Search } from "lucide-react";
import type React from "react";
import { useFilterStore } from "../../stores/filterStore";
import { useViewStore } from "../../stores/viewStore";
import { TableWatermark } from "./TableWatermark";

const MS_PER_HOUR = 60 * 60 * 1000;
const MINUTES_PER_HOUR = 60;

function emptyMessage({
  activeLensId,
  hasFilters,
}: {
  activeLensId: string;
  hasFilters: boolean;
}): string {
  if (activeLensId === "errors") {
    return "No errors in the selected time range";
  }
  if (activeLensId === "conversations") {
    return "No conversations found. Conversations appear when traces include a conversation ID.";
  }
  if (hasFilters) {
    return "No traces match the current filters";
  }
  return "No traces found in the selected time range";
}

function rangeHint({
  hasFilters,
  rangeHours,
}: {
  hasFilters: boolean;
  rangeHours: number;
}): string | null {
  if (hasFilters) return null;
  if (rangeHours < 1) {
    const minutes = Math.round(rangeHours * MINUTES_PER_HOUR);
    return `The current time range only covers ${minutes} minutes. Try expanding to "Last 24 hours" or "Last 7 days".`;
  }
  if (rangeHours < 24) {
    const hours = Math.round(rangeHours);
    return `The current time range only covers ${hours} hours. Try expanding to "Last 24 hours" or "Last 7 days".`;
  }
  return null;
}

export const EmptyFilterState: React.FC = () => {
  const clearAll = useFilterStore((s) => s.clearAll);
  const queryText = useFilterStore((s) => s.queryText);
  const timeRange = useFilterStore((s) => s.timeRange);
  const activeLensId = useViewStore((s) => s.activeLensId);

  const hasFilters = queryText.trim().length > 0;
  const rangeHours = (timeRange.to - timeRange.from) / MS_PER_HOUR;
  const message = emptyMessage({ activeLensId, hasFilters });
  const hint = rangeHint({ hasFilters, rangeHours });
  const showClearAll = hasFilters && activeLensId === "all-traces";

  return (
    <Flex
      align="center"
      justify="center"
      height="full"
      padding={8}
      position="relative"
    >
      <TableWatermark />
      <EmptyState.Root size="md">
        <EmptyState.Content>
          <EmptyState.Indicator>
            <Search />
          </EmptyState.Indicator>
          <VStack textAlign="center" gap={1}>
            <EmptyState.Title>{message}</EmptyState.Title>
            {hint && <EmptyState.Description>{hint}</EmptyState.Description>}
          </VStack>
          {showClearAll && (
            <Button
              size="xs"
              variant="outline"
              colorPalette="blue"
              onClick={clearAll}
            >
              Clear all filters
            </Button>
          )}
        </EmptyState.Content>
      </EmptyState.Root>
    </Flex>
  );
};
