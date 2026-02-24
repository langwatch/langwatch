/**
 * Filter bar for run history list.
 *
 * Provides Scenario and Pass/Fail filter dropdowns on the left,
 * and a Group-by selector on the right.
 */

import { HStack, NativeSelect, Text } from "@chakra-ui/react";
import type { RunGroupType } from "./run-history-transforms";

export type RunHistoryFilterValues = {
  scenarioId: string;
  passFailStatus: string;
};

type RunHistoryFiltersProps = {
  scenarioOptions: Array<{ id: string; name: string }>;
  filters: RunHistoryFilterValues;
  onFiltersChange: (filters: RunHistoryFilterValues) => void;
  groupBy?: RunGroupType;
  onGroupByChange?: (value: RunGroupType) => void;
};

export function RunHistoryFilters({
  scenarioOptions,
  filters,
  onFiltersChange,
  groupBy,
  onGroupByChange,
}: RunHistoryFiltersProps) {
  return (
    <HStack gap={3} flexWrap="wrap" justifyContent="space-between">
      {/* Left: existing filters */}
      <HStack gap={3} flexWrap="wrap">
        <NativeSelect.Root size="sm" width="auto" minWidth="150px">
          <NativeSelect.Field
            value={filters.scenarioId}
            onChange={(e) =>
              onFiltersChange({ ...filters, scenarioId: e.target.value })
            }
            aria-label="Filter by scenario"
          >
            <option value="">All Scenarios</option>
            {scenarioOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>

        <NativeSelect.Root size="sm" width="auto" minWidth="120px">
          <NativeSelect.Field
            value={filters.passFailStatus}
            onChange={(e) =>
              onFiltersChange({ ...filters, passFailStatus: e.target.value })
            }
            aria-label="Filter by pass/fail status"
          >
            <option value="">Pass/Fail</option>
            <option value="pass">Pass</option>
            <option value="fail">Fail</option>
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      </HStack>

      {/* Right: group-by selector */}
      {onGroupByChange && (
        <HStack gap={2}>
          <Text fontSize="sm" color="fg.muted" whiteSpace="nowrap">
            Group by:
          </Text>
          <NativeSelect.Root size="sm" width="auto" minWidth="120px">
            <NativeSelect.Field
              value={groupBy ?? "none"}
              onChange={(e) =>
                onGroupByChange(e.target.value as RunGroupType)
              }
              aria-label="Group by"
            >
              <option value="none">None</option>
              <option value="scenario">Scenario</option>
              <option value="target">Target</option>
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </HStack>
      )}
    </HStack>
  );
}
