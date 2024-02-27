import { Button, HStack, Text } from "@chakra-ui/react";
import { useRouter } from "next/router";
import { Filter } from "react-feather";

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

  return (
    <Button
      variant="outline"
      onClick={() => setShowFilters(!showFilters)}
      minWidth="fit-content"
      isActive={showFilters}
    >
      <HStack spacing={2}>
        <Filter size={16} />
        <Text>Filters</Text>
      </HStack>
    </Button>
  );
}
