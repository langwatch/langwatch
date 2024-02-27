import { Box, Button, HStack, Text } from "@chakra-ui/react";
import { useRouter } from "next/router";
import { Filter } from "react-feather";
import { useFilterParams } from "../../hooks/useFilterParams";

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
  const { filterParams } = useFilterParams();

  return (
    <Button
      variant="outline"
      onClick={() => setShowFilters(!showFilters)}
      minWidth="fit-content"
      isActive={showFilters}
    >
      <HStack spacing={2}>
        {filterParams.filters &&
          Object.keys(filterParams.filters).length > 0 && (
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
              {Object.keys(filterParams.filters).length}
            </Box>
          )}
        <Filter size={16} />
        <Text>Filters</Text>
      </HStack>
    </Button>
  );
}
