import { Box, Button, HStack, Text } from "@chakra-ui/react";
import { useRouter } from "next/router";
import { Filter, X } from "react-feather";
import { type FilterParam, useFilterParams } from "../../hooks/useFilterParams";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { dependencies } from "../../injection/dependencies.client";
import { filterOutEmptyFilters } from "../../server/analytics/utils";
import type { FilterField } from "../../server/filters/types";
import { Tooltip } from "../ui/tooltip";

export const useFilterToggle = (
  { defaultShowFilters } = { defaultShowFilters: false },
) => {
  const router = useRouter();

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

  return { showFilters, setShowFilters };
};

export function FilterToggle({
  defaultShowFilters = false,
}: {
  defaultShowFilters?: boolean;
}) {
  const { showFilters, setShowFilters } = useFilterToggle({
    defaultShowFilters,
  });
  const { filterParams, clearFilters, setNegateFilters } = useFilterParams();

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
  const nonEmptyFilters = filterOutEmptyFilters(filters);
  const hasAnyFilters = Object.keys(nonEmptyFilters).length > 0;
  const { project } = useOrganizationTeamProject();

  const hasNegateFilters = dependencies.hasNegateFilters?.({
    projectId: project?.id ?? "",
  });

  return (
    <HStack gap={2}>
      <Button
        variant="ghost"
        backgroundColor={toggled ? "gray.200" : undefined}
        onClick={onClick}
        minWidth="fit-content"
        paddingRight={hasAnyFilters ? 1 : undefined}
      >
        <HStack gap={0}>
          {hasAnyFilters && (
            <Box
              width="12px"
              height="12px"
              borderRadius="12px"
              background="red.500"
              position="absolute"
              marginTop="10px"
              marginLeft="8px"
              fontSize="8px"
              color="white"
              lineHeight="12px"
              textAlign="center"
            >
              {Object.keys(nonEmptyFilters).length}
            </Box>
          )}
          <Filter size={16} />
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
