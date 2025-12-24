import { Box, Button, HStack, Text } from "@chakra-ui/react";
import { useRouter } from "next/router";
import { X } from "react-feather";
import { type FilterParam, useFilterParams } from "../../hooks/useFilterParams";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { dependencies } from "../../injection/dependencies.client";
import { filterOutEmptyFilters } from "../../server/analytics/utils";
import type { FilterField } from "../../server/filters/types";
import { Tooltip } from "../ui/tooltip";
import { FilterIconWithBadge } from "./FilterIconWithBadge";

/**
 * Utility to get filter count from a filters object
 */
export const getFilterCount = (
  filters: Partial<Record<FilterField, FilterParam>> | undefined,
) => {
  const nonEmptyFilters = filterOutEmptyFilters(filters);
  const filterCount = Object.keys(nonEmptyFilters).length;
  const hasAnyFilters = filterCount > 0;
  return { nonEmptyFilters, filterCount, hasAnyFilters };
};

export const useFilterToggle = (
  { defaultShowFilters } = { defaultShowFilters: false },
) => {
  const router = useRouter();
  const {
    filterParams,
    filterCount,
    hasAnyFilters,
    clearFilters,
    setNegateFilters,
  } = useFilterParams();

  const showFilters =
    typeof router.query.show_filters === "string"
      ? router.query.show_filters === "true"
      : defaultShowFilters;

  const setShowFilters = (show: boolean) => {
    void router.push(
      {
        query: Object.fromEntries(
          Object.entries({
            ...router.query,
            show_filters: show
              ? defaultShowFilters
                ? undefined
                : "true"
              : defaultShowFilters
                ? "false"
                : undefined,
          }).filter(([, value]) => value !== undefined),
        ),
      },
      undefined,
      { shallow: true },
    );
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

export function FilterToggle({
  defaultShowFilters = false,
}: {
  defaultShowFilters?: boolean;
}) {
  const {
    showFilters,
    setShowFilters,
    filterParams,
    clearFilters,
    setNegateFilters,
  } = useFilterToggle({
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
  const { project } = useOrganizationTeamProject();
  const { filterCount, hasAnyFilters } = getFilterCount(filters);

  const hasNegateFilters = dependencies.hasNegateFilters?.({
    projectId: project?.id ?? "",
  });

  return (
    <HStack gap={2}>
      <Button
        size="sm"
        variant="outline"
        backgroundColor={toggled ? "gray.200" : undefined}
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
      {hasNegateFilters && setNegateFilters && (
        <Tooltip content="Negate filters" positioning={{ gutter: 0 }}>
          <Button
            variant="plain"
            width="fit-content"
            minWidth={0}
            backgroundColor={negateFiltersToggled ? "gray.200" : undefined}
            onClick={(e) => {
              e.stopPropagation();
              setNegateFilters(!negateFiltersToggled);
            }}
          >
            <span style={{ fontSize: "20px", marginTop: "-4px" }}>¬</span>{" "}
            Negate Filters
          </Button>
        </Tooltip>
      )}
    </HStack>
  );
}
