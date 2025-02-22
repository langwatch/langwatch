import { Box, Button, HStack, Text } from "@chakra-ui/react";
import { useRouter } from "next/router";
import { Filter, X } from "react-feather";
import { useFilterParams } from "../../hooks/useFilterParams";
import { Tooltip } from "../ui/tooltip";

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
  const { filterParams, clearFilters, nonEmptyFilters } = useFilterParams();

  const hasAnyFilters = nonEmptyFilters.length > 0;

  return (
    <Button
      variant="ghost"
      backgroundColor={showFilters ? "gray.200" : undefined}
      onClick={() => setShowFilters(!showFilters)}
      minWidth="fit-content"
      paddingRight={hasAnyFilters ? 1 : undefined}
    >
      <HStack gap={0}>
        {filterParams.filters && hasAnyFilters && (
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
            {nonEmptyFilters.length}
          </Box>
        )}
        <Filter size={16} />
        <Text paddingLeft={2}>Filters</Text>
        {hasAnyFilters && (
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
                clearFilters();
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
