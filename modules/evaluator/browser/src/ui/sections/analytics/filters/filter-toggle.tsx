import type { FilterField } from "@langwatch/analytics-filters";
import { useRouter } from "@langwatch/browser-host/use-router";
import { Menu } from "@langwatch/design-system/menu";
import { Button, HStack, Text } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import qs from "qs";
import { X } from "react-feather";
import { LuCheck, LuEllipsis } from "react-icons/lu";

import { URL_QS_PARSE_OPTIONS } from "../../../../model/analytics/qs-parse-options.ts";
import { type FilterParam, useFilterParams } from "../use-filter-params.ts";
import { filterOutEmptyFilters } from "../utils.ts";
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
      {hasAnyFilters && setNegateFilters && (
        <Menu.Root>
          <Menu.Trigger asChild>
            <Button size="sm" variant="ghost" aria-label="More filter actions">
              <LuEllipsis aria-hidden="true" />
            </Button>
          </Menu.Trigger>
          <Menu.Content>
            <Menu.Item
              value="negate-filters"
              onClick={() => setNegateFilters(!negateFiltersToggled)}
            >
              <LuCheck
                aria-hidden="true"
                visibility={negateFiltersToggled ? "visible" : "hidden"}
              />{" "}
              Negate filters
            </Menu.Item>
          </Menu.Content>
        </Menu.Root>
      )}
    </HStack>
  );
}
