import { VStack } from "@chakra-ui/react";
import React from "react";
import { QueryStringFieldsFilters } from "./fields-filters.tsx";
import { useFilterToggle } from "../../behavior/use-filter-toggle.ts";
import { TopicsSelector } from "./topics-selector.tsx";

export const FilterSidebar = React.memo(function FilterSidebar({
  defaultShowFilters = false,
  hideTopics = false,
}: {
  defaultShowFilters?: boolean;
  hideTopics?: boolean;
}) {
  const { showFilters } = useFilterToggle({ defaultShowFilters });

  return (
    showFilters && (
      <VStack
        align="start"
        minWidth="380"
        maxWidth="380"
        gap={4}
        paddingTop={2}
        paddingBottom={"58px"}
      >
        {!hideTopics && <TopicsSelector />}
        <QueryStringFieldsFilters />
      </VStack>
    )
  );
});
