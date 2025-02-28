import { VStack } from "@chakra-ui/react";
import React from "react";
import { FieldsFilters } from "./FieldsFilters";
import { TopicsSelector } from "./TopicsSelector";
import { useFilterToggle } from "./FilterToggle";

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
        gap={12}
        paddingTop={2}
        paddingBottom={"120px"}
      >
        {!hideTopics && <TopicsSelector />}
        <FieldsFilters />
      </VStack>
    )
  );
});
