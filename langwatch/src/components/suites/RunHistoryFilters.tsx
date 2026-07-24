/**
 * Filter bar for run history list.
 *
 * Provides Scenario and Pass/Fail filter dropdowns on the left,
 * and a Group-by selector on the right.
 */

import { HStack, IconButton, NativeSelect, Text } from "@chakra-ui/react";
import { LayoutGrid, List } from "lucide-react";
import { RUN_GROUP_TYPES, type RunGroupType } from "./run-history-transforms";
import type { ViewMode } from "./useRunHistoryStore";

/** Display labels for each group-by option. */
const GROUP_BY_LABELS: Record<RunGroupType, string> = {
  none: "None",
  scenario: "Scenario",
  target: "Target",
};

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
  /** Which group-by options to render. Defaults to all options when omitted. */
  groupByOptions?: RunGroupType[];
  viewMode?: ViewMode;
  onViewModeChange?: (value: ViewMode) => void;
};

export function RunHistoryFilters({
  scenarioOptions,
  filters,
  onFiltersChange,
  groupBy,
  onGroupByChange,
  groupByOptions = [...RUN_GROUP_TYPES],
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
            <option value="">All Statuses</option>
            <option value="pass">Pass</option>
            <option value="fail">Fail</option>
            <option value="stalled">Stalled</option>
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      </HStack>

      {/* Right: view mode toggle + group-by selector */}
      <HStack gap={3}>
        {onViewModeChange && (
          <HStack gap={1} role="group" aria-label="View mode">
            <IconButton
              aria-label="List view"
              aria-pressed={viewMode === "list"}
              size="xs"
              variant={viewMode === "list" ? "solid" : "ghost"}
              onClick={() => onViewModeChange("list")}
            >
              <List size={14} />
            </IconButton>
            <IconButton
              aria-label="Grid view"
              aria-pressed={viewMode === "grid"}
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
                {groupByOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {GROUP_BY_LABELS[opt]}
                  </option>
                ))}
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </HStack>
        )}
      </HStack>
    </HStack>
  );
}
