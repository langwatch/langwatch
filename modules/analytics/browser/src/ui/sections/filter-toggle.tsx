/**
 * The rail's trigger and its count: the rendering half; reading and writing
 * is `behavior/use-filter-toggle.ts`.
 */

import { Button, HStack, Text } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { X } from "react-feather";

import { useFilterToggle } from "../../behavior/use-filter-toggle.ts";
import type { FilterField } from "../../model/analytics-filter-definition.ts";
import { countFilters, type FilterParam } from "../../model/analytics-filter-params.ts";
import { FilterIconWithBadge } from "./filter-icon-with-badge.tsx";

export function FilterToggle({ defaultShowFilters = false }: { defaultShowFilters?: boolean }) {
  const { showFilters, setShowFilters, filterParams, clearFilters } = useFilterToggle({
    defaultShowFilters,
  });

  return (
    <FilterToggleButton
      toggled={showFilters}
      onClick={() => setShowFilters(!showFilters)}
      filters={filterParams.filters}
      onClear={clearFilters}
    >
      Filters
    </FilterToggleButton>
  );
}

export function FilterToggleButton({
  toggled,
  onClick,
  filters,
  onClear,
  children,
}: {
  toggled: boolean;
  onClick?: () => void;
  filters: Partial<Record<FilterField, FilterParam>>;
  onClear?: () => void;
  children: React.ReactNode;
}) {
  const { filterCount, hasAnyFilters } = countFilters(filters);

  return (
    <HStack gap={2}>
      <Button
        size="sm"
        variant="outline"
        backgroundColor={toggled ? "bg.muted" : undefined}
        onClick={onClick}
        minWidth="fit-content"
      >
        <HStack gap={0}>
          <FilterIconWithBadge count={filterCount} />
          <Text paddingLeft={2}>{children}</Text>
        </HStack>
      </Button>
      {hasAnyFilters && onClear && (
        <Tooltip content="Clear all filters" positioning={{ gutter: 0 }}>
          <Button
            size="sm"
            variant="plain"
            width="fit-content"
            minWidth={0}
            paddingX={2}
            aria-label="Clear all filters"
            onClick={onClear}
          >
            <X width={12} style={{ minWidth: "12px" }} />
          </Button>
        </Tooltip>
      )}
    </HStack>
  );
}
