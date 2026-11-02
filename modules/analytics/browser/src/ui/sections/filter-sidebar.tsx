import { VStack } from "@langwatch/design-system/primitives";
import { isAggregateProjectKind } from "@langwatch/project-contract";
import React from "react";

import { useFilterToggle } from "../../behavior/use-filter-toggle.ts";
import { useAnalyticsHost } from "../../model/analytics-host.ts";
import { QueryStringFieldsFilters } from "./fields-filters.tsx";
import { TopicsSelector } from "./topics-selector.tsx";

export const FilterSidebar = React.memo(function FilterSidebar({
  defaultShowFilters = false,
  hideTopics = false,
}: {
  defaultShowFilters?: boolean;
  hideTopics?: boolean;
}) {
  const { showFilters } = useFilterToggle({ defaultShowFilters });
  // Topics are clustered inside one project, so an aggregate offers none (ADR-177 v4.15).
  const offersTopics = !hideTopics && !isAggregateProjectKind(useAnalyticsHost().project()?.kind);

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
        {offersTopics && <TopicsSelector />}
        <QueryStringFieldsFilters />
      </VStack>
    )
  );
});
