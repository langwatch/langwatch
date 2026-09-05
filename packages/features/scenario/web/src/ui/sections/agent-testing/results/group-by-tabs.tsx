/**
 * How the results are grouped: four connected tabs inside one enclosure.
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { HStack, Text } from "@chakra-ui/react";
import { useMemo } from "react";
import { SegmentedControl } from "@langwatch/design-system/segmented-control";
import { FG_MUTED } from "../../../../model/agent-testing/shared/design";
import { RESULT_GROUPING_LABELS, RESULT_GROUPINGS, type ResultGrouping } from "./result-atoms";

function isResultGrouping(value: string): value is ResultGrouping {
  return (RESULT_GROUPINGS as readonly string[]).includes(value);
}

export type GroupByTabsProps = {
  grouping: ResultGrouping;
  onGroupingChange: (grouping: ResultGrouping) => void;
};

export function GroupByTabs({ grouping, onGroupingChange }: GroupByTabsProps) {
  const items = useMemo(
    () =>
      RESULT_GROUPINGS.map((value) => ({
        value,
        label: RESULT_GROUPING_LABELS[value],
      })),
    [],
  );

  return (
    <HStack gap={1.5}>
      <Text fontSize="12.5px" color={FG_MUTED} whiteSpace="nowrap">
        Group by:
      </Text>
      <SegmentedControl
        size="sm"
        // The size recipe sets the label size on the item, so the toolbar's
        // 12.5px is set on the part rather than inherited from the enclosure.
        css={{ "& [data-part='item-text']": { fontSize: "12.5px" } }}
        value={grouping}
        items={items}
        aria-label="Group results by"
        data-testid="results-group-by"
        onValueChange={({ value }) => {
          if (value && isResultGrouping(value)) onGroupingChange(value);
        }}
      />
    </HStack>
  );
}
