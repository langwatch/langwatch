/**
 * Filter bar for run history list.
 *
 * Provides Scenario and Pass/Fail filter dropdowns.
 *
 * Note: Target filtering is not yet supported because ScenarioRunData
 * in ElasticSearch does not store the target reference per run.
 * This can be added once the ES data model is enriched with target info.
 */

import { HStack, NativeSelect } from "@chakra-ui/react";

export type RunHistoryFilterValues = {
  scenarioId: string;
  passFailStatus: string;
};

type RunHistoryFiltersProps = {
  scenarioOptions: Array<{ id: string; name: string }>;
  filters: RunHistoryFilterValues;
  onFiltersChange: (filters: RunHistoryFilterValues) => void;
};

export function RunHistoryFilters({
  scenarioOptions,
  filters,
  onFiltersChange,
}: RunHistoryFiltersProps) {
  return (
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
  );
}
