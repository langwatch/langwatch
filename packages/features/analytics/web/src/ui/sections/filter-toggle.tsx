/**
 * The rail's trigger, and the count on it.
 *
 * The RENDERING half of `platform/app/src/components/filters/FilterToggle.tsx`;
 * the `?show_filters=` reading and writing is `behavior/use-filter-toggle.ts`.
 * The platform module stays — `components/checks/TryItOut` renders it too, and
 * deletes-only forbids repointing that one.
 */

import { Box, Button, HStack, Text } from "@chakra-ui/react";
import { X } from "react-feather";
import { Tooltip } from "@langwatch/design-system/tooltip";

import { countFilters, type FilterParam } from "../../model/analytics-filter-params";
import type { FilterField } from "../../model/analytics-filter-definition";
import { useFilterToggle } from "../../behavior/use-filter-toggle";
import { FilterIconWithBadge } from "./filter-icon-with-badge";

export function FilterToggle({ defaultShowFilters = false }: { defaultShowFilters?: boolean }) {
  const { showFilters, setShowFilters, filterParams, clearFilters, setNegateFilters } =
    useFilterToggle({
      defaultShowFilters,
    });

  return (
    <FilterToggleButton
      toggled={showFilters}
      onClick={() => setShowFilters(!showFilters)}
      filters={filterParams.filters}
      onClear={clearFilters}
      negateFiltersToggled={filterParams.negateFilters}
      setNegateFilters={setNegateFilters}
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
  negateFiltersToggled,
  setNegateFilters,
}: {
  toggled: boolean;
  onClick?: () => void;
  filters: Partial<Record<FilterField, FilterParam>>;
  onClear?: () => void;
  children: React.ReactNode;
  negateFiltersToggled?: boolean;
  setNegateFilters?: (negateFilters: boolean) => void;
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
        paddingRight={hasAnyFilters ? 1 : undefined}
      >
        <HStack gap={0}>
          <FilterIconWithBadge count={filterCount} />
          <Text paddingLeft={2}>{children}</Text>
          {hasAnyFilters && onClear && (
            <Tooltip content="Clear all filters" positioning={{ gutter: 0 }}>
              <Button
                as={Box}
                role="button"
                variant="plain"
                width="fit-content"
                minWidth={0}
                display="flex"
                onClick={(e) => {
                  e.stopPropagation();
                  onClear?.();
                }}
                paddingX={2}
              >
                <X width={12} style={{ minWidth: "12px" }} />
              </Button>
            </Tooltip>
          )}
        </HStack>
      </Button>
      {setNegateFilters && (
        <Tooltip content="Negate filters" positioning={{ gutter: 0 }}>
          <Button
            variant="plain"
            width="fit-content"
            minWidth={0}
            backgroundColor={negateFiltersToggled ? "bg.muted" : undefined}
            onClick={(e) => {
              e.stopPropagation();
              setNegateFilters(!negateFiltersToggled);
            }}
          >
            <span style={{ fontSize: "20px", marginTop: "-4px" }}>¬</span> Negate Filters
          </Button>
        </Tooltip>
      )}
    </HStack>
  );
}
