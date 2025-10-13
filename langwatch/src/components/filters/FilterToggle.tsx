import { Box, Button, HStack, Text } from "@chakra-ui/react";
import { useRouter } from "next/router";
import { Filter, X } from "react-feather";
import {
  nonEmptyFilters,
  useFilterParams,
  type FilterParam,
} from "../../hooks/useFilterParams";
import { Tooltip } from "../ui/tooltip";
import type { FilterField } from "../../server/filters/types";

export const useFilterToggle = (
  { defaultShowFilters } = { defaultShowFilters: false }
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
          }).filter(([, value]) => value !== undefined)
        ),
      },
      undefined,
      { shallow: true }
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
  const { filterParams, clearFilters } = useFilterParams();

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
  const nonEmptyFilters_ = nonEmptyFilters(filters);
  const hasAnyFilters = nonEmptyFilters_.length > 0;

  return (
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
            {nonEmptyFilters_.length}
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
  );
}
