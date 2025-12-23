import { VStack } from "@chakra-ui/react";
import React from "react";
import { QueryStringFieldsFilters } from "./FieldsFilters";
import { useFilterToggle } from "./FilterToggle";
import { TopicsSelector } from "./TopicsSelector";

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
        gap={8}
        paddingTop={2}
        paddingBottom={"120px"}
      >
        {!hideTopics && <TopicsSelector />}
        <QueryStringFieldsFilters />
      </VStack>
    )
  );
});
