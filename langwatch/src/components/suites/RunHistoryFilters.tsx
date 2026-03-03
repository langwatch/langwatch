/**
 * Filter bar for run history list.
 *
 * Provides Scenario and Pass/Fail filter dropdowns on the left,
 * and a Group-by selector on the right.
 */

import { HStack, IconButton, NativeSelect, Text } from "@chakra-ui/react";
import { LayoutGrid, List } from "lucide-react";
import type { RunGroupType } from "./run-history-transforms";
import type { ViewMode } from "./useRunHistoryStore";

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
  viewMode?: ViewMode;
  onViewModeChange?: (value: ViewMode) => void;
};

export function RunHistoryFilters({
  scenarioOptions,
  filters,
  onFiltersChange,
  groupBy,
  onGroupByChange,
  viewMode,
  onViewModeChange,
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

      {/* Right: view mode toggle + group-by selector */}
      <HStack gap={3}>
        {onViewModeChange && (
          <HStack gap={1}>
            <IconButton
              aria-label="List view"
              size="xs"
              variant={viewMode === "list" ? "solid" : "ghost"}
              onClick={() => onViewModeChange("list")}
            >
              <List size={14} />
            </IconButton>
            <IconButton
              aria-label="Grid view"
              size="xs"
              variant={viewMode === "grid" ? "solid" : "ghost"}
              onClick={() => onViewModeChange("grid")}
            >
              <LayoutGrid size={14} />
            </IconButton>
          </HStack>
        )}
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
    </HStack>
  );
}
