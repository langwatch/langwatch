/**
 * The filter row of the Results tab: how the list is grouped, what is cut from
 * it, and the window it all sits in.
 *
 * It reads above the numbers it drives. Filters first, then the stat strip and
 * the chart, then the table, so a person sets the question before reading the
 * answer rather than the other way round.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { Box, Button, HStack, NativeSelect } from "@chakra-ui/react";
import { ChartColumn } from "lucide-react";
import type {
  Period,
  PeriodMode,
  RelativePresetKey,
} from "@langwatch/analytics-web/components/PeriodSelector";
import { FG_MUTED } from "../../../../model/agent-testing/shared/design";
import { AgentTestingPeriodPicker } from "../../../elements/agent-testing/shared/period-picker";
import { ToggleButton } from "../../../elements/agent-testing/shared/toggle-button";
import { GroupByTabs } from "./group-by-tabs";
import { ResultsFilterMenu, type ResultsFilterOption } from "./results-filter-menu";
import {
  EMPTY_RESULT_FILTERS,
  isNarrowed,
  type ResultFilters,
  type ResultGrouping,
} from "./result-atoms";

/**
 * The height and the type size every control of the row shares. The filter
 * chips, the status select, the Charts toggle and the period picker sit on
 * one line, so one of them at another height reads as a mistake.
 */
const TOOLBAR_CONTROL_HEIGHT = "32px";
const TOOLBAR_FONT_SIZE = "12.5px";

export type ResultsFilterRowProps = {
  grouping: ResultGrouping;
  onGroupingChange: (grouping: ResultGrouping) => void;
  filters: ResultFilters;
  onFiltersChange: (filters: ResultFilters) => void;
  /** Built from everything in the window, not from what the filters left. */
  scenarioOptions: ResultsFilterOption[];
  labelOptions: ResultsFilterOption[];
  targetOptions: ResultsFilterOption[];
  isChartsShown: boolean;
  onChartsToggle: () => void;
  period: Period;
  periodMode: PeriodMode;
  setPeriod: (startDate: Date, endDate: Date) => void;
  setRelativePeriod: (key: RelativePresetKey) => void;
};

export function ResultsFilterRow({
  grouping,
  onGroupingChange,
  filters,
  onFiltersChange,
  scenarioOptions,
  labelOptions,
  targetOptions,
  isChartsShown,
  onChartsToggle,
  period,
  periodMode,
  setPeriod,
  setRelativePeriod,
}: ResultsFilterRowProps) {
  return (
    <HStack gap={1.5} flexWrap="wrap" data-testid="agent-testing-results-filter-row">
      <GroupByTabs grouping={grouping} onGroupingChange={onGroupingChange} />

      <Box width="1px" height="20px" background="border" marginX={1} />

      <ResultsFilterMenu
        label="Scenario"
        options={scenarioOptions}
        selected={filters.scenarioIds}
        onChange={(scenarioIds) => onFiltersChange({ ...filters, scenarioIds })}
      />
      <ResultsFilterMenu
        label="Label"
        options={labelOptions}
        selected={filters.labels}
        onChange={(labels) => onFiltersChange({ ...filters, labels })}
      />
      <ResultsFilterMenu
        label="Target"
        options={targetOptions}
        selected={filters.targetKeys}
        onChange={(targetKeys) => onFiltersChange({ ...filters, targetKeys })}
      />

      <NativeSelect.Root size="sm" width="auto" minWidth="120px">
        <NativeSelect.Field
          height={TOOLBAR_CONTROL_HEIGHT}
          fontSize={TOOLBAR_FONT_SIZE}
          value={filters.status}
          aria-label="Filter by status"
          data-testid="results-filter-status"
          onChange={(event) =>
            onFiltersChange({
              ...filters,
              status: event.target.value as ResultFilters["status"],
            })
          }
        >
          <option value="all">All statuses</option>
          <option value="passed">Passed</option>
          <option value="failed">Failed</option>
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>

      {isNarrowed(filters) ? (
        <Button
          size="xs"
          variant="ghost"
          height="32px"
          fontSize="11.5px"
          fontWeight="medium"
          color={FG_MUTED}
          onClick={() => onFiltersChange(EMPTY_RESULT_FILTERS)}
        >
          Reset filters
        </Button>
      ) : null}

      <ToggleButton
        isOn={isChartsShown}
        onClick={onChartsToggle}
        data-testid="results-charts-toggle"
      >
        <ChartColumn size={13} />
        Charts
      </ToggleButton>

      <Box flex={1} minWidth={2} />

      <AgentTestingPeriodPicker
        period={period}
        periodMode={periodMode}
        setPeriod={setPeriod}
        setRelativePeriod={setRelativePeriod}
      />
    </HStack>
  );
}
