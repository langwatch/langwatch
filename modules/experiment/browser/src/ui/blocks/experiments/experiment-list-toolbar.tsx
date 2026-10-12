import { Button, Flex, HStack, Text } from "@langwatch/design-system/primitives";
import { SearchInput } from "@langwatch/design-system/search-input";
import { SegmentedControl } from "@langwatch/design-system/segmented-control";

import {
  isNarrowed,
  NO_FILTERS,
  STATUS_OPTIONS,
  type ListFilters,
  type ListGrouping,
} from "../../../model/experiments/experiment-list-filter.ts";
import { ExperimentFilterMenu } from "./experiment-filter-menu.tsx";

/** Search, "Ran via", "Status" and Reset on the left; "Group by" on the right. */
export function ExperimentListToolbar({
  filters,
  onFilters,
  kinds,
  grouping,
  onGrouping,
}: {
  filters: ListFilters;
  onFilters: (next: ListFilters) => void;
  kinds: string[];
  grouping: ListGrouping;
  onGrouping: (next: ListGrouping) => void;
}) {
  return (
    <Flex wrap="wrap" align="center" gap={2} minWidth={0}>
      <SearchInput
        value={filters.query}
        onChange={(event) => onFilters({ ...filters, query: event.target.value })}
        placeholder="Search experiments"
        aria-label="Search experiments"
        containerProps={{ width: "220px", flexShrink: 0 }}
      />
      <ExperimentFilterMenu
        label="Ran via"
        options={kinds.map((kind) => ({ value: kind, label: kind }))}
        selected={filters.kinds}
        onChange={(next) => onFilters({ ...filters, kinds: next })}
      />
      <ExperimentFilterMenu
        label="Status"
        options={STATUS_OPTIONS}
        selected={filters.statuses}
        onChange={(next) => onFilters({ ...filters, statuses: next })}
      />
      {isNarrowed(filters) && (
        <Button size="xs" variant="plain" color="fg.muted" onClick={() => onFilters(NO_FILTERS)}>
          Reset
        </Button>
      )}
      <HStack gap={2} marginStart="auto">
        <Text textStyle="bodySm" color="fg.muted">
          Group by
        </Text>
        <SegmentedControl
          size="sm"
          value={grouping}
          onValueChange={(details) => onGrouping(details.value === "kind" ? "kind" : "none")}
          items={[
            { value: "none", label: "None" },
            { value: "kind", label: "How it ran" },
          ]}
        />
      </HStack>
    </Flex>
  );
}
