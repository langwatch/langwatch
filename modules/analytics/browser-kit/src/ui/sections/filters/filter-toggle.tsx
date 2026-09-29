import { Button, HStack, Text } from "@chakra-ui/react";
import { useRouter } from "@langwatch/browser-host/use-router";
import { Tooltip } from "@langwatch/design-system/tooltip";
import qs from "qs";
import { X } from "react-feather";

import type { FilterField } from "../../../model/filters/types.ts";
import { URL_QS_PARSE_OPTIONS } from "../../../model/qs-parse-options.ts";
import { filterOutEmptyFilters } from "../analytics/utils.ts";
import { type FilterParam, useFilterParams } from "../use-filter-params.ts";
import { FilterIconWithBadge } from "./filter-icon-with-badge.tsx";

/**
 * Utility to get filter count from a filters object
 */
export const getFilterCount = (filters: Partial<Record<FilterField, FilterParam>> | undefined) => {
  const nonEmptyFilters = filterOutEmptyFilters(filters);
  const filterCount = Object.keys(nonEmptyFilters).length;
  const hasAnyFilters = filterCount > 0;
  return { nonEmptyFilters, filterCount, hasAnyFilters };
};

export const useFilterToggle = ({ defaultShowFilters } = { defaultShowFilters: false }) => {
  const router = useRouter();
  const { filterParams, filterCount, hasAnyFilters, clearFilters, setNegateFilters } =
    useFilterParams();

  const showFilters =
    typeof router.query.show_filters === "string"
      ? router.query.show_filters === "true"
      : defaultShowFilters;

  const setShowFilters = (show: boolean) => {
    const currentPath = router.asPath.split("?")[0] ?? router.asPath;
    const queryString = router.asPath.split("?")[1] ?? "";
    const queryParams = qs.parse(queryString.replaceAll("%2C", ","), URL_QS_PARSE_OPTIONS);

    const shownValue = defaultShowFilters ? undefined : "true";
    const hiddenValue = defaultShowFilters ? "false" : undefined;
    const showFiltersValue = show ? shownValue : hiddenValue;

    const newParams = { ...queryParams };
    if (showFiltersValue === undefined) {
      delete newParams.show_filters;
    } else {
      newParams.show_filters = showFiltersValue;
    }

    const newQs = qs.stringify(newParams, {
      allowDots: true,
      arrayFormat: "comma" as const,
      allowEmptyArrays: true,
    });

    void router.push(newQs ? `${currentPath}?${newQs}` : currentPath);
  };

  return {
    showFilters,
    setShowFilters,
    filterCount,
    hasAnyFilters,
    filterParams,
    clearFilters,
    setNegateFilters,
  };
};

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
  const { filterCount, hasAnyFilters } = getFilterCount(filters);

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
